import { CardGameClient, CARD_ZONE_TYPES, DEFAULT_ZONE_FRAMEWORK, createDeckToHandDealHook, loadPreviewTuning } from '/public/card-game/index.js';
import { CardRollerOverlay } from './CardRollerOverlay.js';
import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const PLAYER_SIDE = 'player';
const OPPONENT_SIDE = 'opponent';
const BOARD_SLOTS_PER_SIDE = 3;
const UPKEEP_TEXT_CANVAS_SIZE = { width: 1024, height: 256 };
const DEFAULT_UPKEEP_PANEL_SIZE = { width: 1.65, height: 0.38 };
const DEFAULT_UPKEEP_POSITION = { x: -0.95, y: 0.82, z: -2.2 };
const DEFAULT_UPKEEP_TEXT_POSITION = { x: 0, y: 0 };
const UPKEEP_REFERENCE_CAMERA = { fov: 45, aspect: 16 / 9 };

function getFrustumHalfExtents(fovDegrees, aspect, depth) {
  const safeDepth = Math.max(Math.abs(depth), 0.001);
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2) * safeDepth;
  return {
    halfHeight,
    halfWidth: halfHeight * Math.max(aspect, 0.001),
  };
}

function createTabPlayerId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `player-${window.crypto.randomUUID().slice(0, 8)}`;
  }
  return `player-${Math.random().toString(36).slice(2, 10)}`;
}

function getPhaseLabel(phase) {
  return phase === 1 ? 'Decision' : 'Commit';
}

export class PhaseManagerClient {
  constructor({ elements, options = {} }) {
    this.elements = elements;
    this.options = {
      pollIntervalMs: 1200,
      ...options,
    };
    this.client = null;
    this.match = null;
    this.matchmakingPollTimer = 0;
    this.stateSyncInFlight = false;
    this.lastAnimatedMatchId = null;
    this.lastAnimatedTurnKey = null;
    this.lastAnimatedCommitKey = null;
    this.commitSequencePromise = null;
    this.activeCommitSequenceKey = null;
    this.cardRollerOverlay = null;
    this.upkeepDisplay = null;
    this.upkeepPosition = { ...DEFAULT_UPKEEP_POSITION };
    this.upkeepPanelSize = { ...DEFAULT_UPKEEP_PANEL_SIZE };
    this.upkeepTextPosition = { ...DEFAULT_UPKEEP_TEXT_POSITION };
    this.upkeepBackgroundAssetPath = '';
    this.upkeepBackgroundImage = null;
    this.upkeepBackgroundCache = new Map();
    this.availableUpkeepAssets = [];
    this.playedRemoteSpellResolutionIds = new Set();
    this.previewTuning = loadPreviewTuning();
    this.playerId = createTabPlayerId();

    this.beginMatchmaking = this.beginMatchmaking.bind(this);
    this.readyUp = this.readyUp.bind(this);
    this.resetMatch = this.resetMatch.bind(this);
    this.handleUpkeepPositionInput = this.handleUpkeepPositionInput.bind(this);
    this.handleUpkeepPanelStyleInput = this.handleUpkeepPanelStyleInput.bind(this);
    this.handleUpkeepBackgroundChange = this.handleUpkeepBackgroundChange.bind(this);
    this.exportUpkeepPosition = this.exportUpkeepPosition.bind(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);
  }

  handleWindowResize() {
    this.positionUpkeepDisplay();
    window.requestAnimationFrame(() => {
      this.positionUpkeepDisplay();
    });
  }

  async postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }
    return payload;
  }

  async getJson(url) {
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }
    return payload;
  }

  parseUpkeepPositionValue(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  syncUpkeepPositionInputs() {
    const {
      upkeepXInput,
      upkeepYInput,
      upkeepZInput,
      upkeepWidthInput,
      upkeepHeightInput,
      upkeepTextXInput,
      upkeepTextYInput,
      upkeepXValueEl,
      upkeepYValueEl,
      upkeepZValueEl,
      upkeepWidthValueEl,
      upkeepHeightValueEl,
      upkeepTextXValueEl,
      upkeepTextYValueEl,
    } = this.elements;
    const xValue = this.upkeepPosition.x.toFixed(2);
    const yValue = this.upkeepPosition.y.toFixed(2);
    const zValue = this.upkeepPosition.z.toFixed(2);
    const widthValue = this.upkeepPanelSize.width.toFixed(2);
    const heightValue = this.upkeepPanelSize.height.toFixed(2);
    const textXValue = this.upkeepTextPosition.x.toFixed(2);
    const textYValue = this.upkeepTextPosition.y.toFixed(2);
    if (upkeepXInput) upkeepXInput.value = xValue;
    if (upkeepYInput) upkeepYInput.value = yValue;
    if (upkeepZInput) upkeepZInput.value = zValue;
    if (upkeepWidthInput) upkeepWidthInput.value = widthValue;
    if (upkeepHeightInput) upkeepHeightInput.value = heightValue;
    if (upkeepTextXInput) upkeepTextXInput.value = textXValue;
    if (upkeepTextYInput) upkeepTextYInput.value = textYValue;
    if (upkeepXValueEl) upkeepXValueEl.textContent = xValue;
    if (upkeepYValueEl) upkeepYValueEl.textContent = yValue;
    if (upkeepZValueEl) upkeepZValueEl.textContent = zValue;
    if (upkeepWidthValueEl) upkeepWidthValueEl.textContent = widthValue;
    if (upkeepHeightValueEl) upkeepHeightValueEl.textContent = heightValue;
    if (upkeepTextXValueEl) upkeepTextXValueEl.textContent = textXValue;
    if (upkeepTextYValueEl) upkeepTextYValueEl.textContent = textYValue;
  }

  handleUpkeepPositionInput() {
    const { upkeepXInput, upkeepYInput, upkeepZInput } = this.elements;
    this.upkeepPosition = {
      x: this.parseUpkeepPositionValue(upkeepXInput?.value, this.upkeepPosition.x),
      y: this.parseUpkeepPositionValue(upkeepYInput?.value, this.upkeepPosition.y),
      z: this.parseUpkeepPositionValue(upkeepZInput?.value, this.upkeepPosition.z),
    };
    this.syncUpkeepPositionInputs();
    this.positionUpkeepDisplay();
  }

  handleUpkeepPanelStyleInput() {
    const { upkeepWidthInput, upkeepHeightInput, upkeepTextXInput, upkeepTextYInput } = this.elements;
    this.upkeepPanelSize = {
      width: this.parseUpkeepPositionValue(upkeepWidthInput?.value, this.upkeepPanelSize.width),
      height: this.parseUpkeepPositionValue(upkeepHeightInput?.value, this.upkeepPanelSize.height),
    };
    this.upkeepTextPosition = {
      x: this.parseUpkeepPositionValue(upkeepTextXInput?.value, this.upkeepTextPosition.x),
      y: this.parseUpkeepPositionValue(upkeepTextYInput?.value, this.upkeepTextPosition.y),
    };
    this.syncUpkeepPositionInputs();
    this.positionUpkeepDisplay();
    if (this.upkeepDisplay?.value != null) {
      this.drawUpkeepDisplay(this.upkeepDisplay.value);
    }
  }

  async fetchUpkeepAssets() {
    try {
      const payload = await this.getJson('/api/assets');
      this.availableUpkeepAssets = Array.isArray(payload?.assets) ? payload.assets : [];
    } catch (error) {
      this.availableUpkeepAssets = [];
    }
    this.syncUpkeepBackgroundOptions();
  }

  syncUpkeepBackgroundOptions() {
    const { upkeepBackgroundSelect } = this.elements;
    if (!upkeepBackgroundSelect) return;

    const optionMarkup = ['<option value="">Default generated panel</option>']
      .concat(this.availableUpkeepAssets.map((asset) => `<option value="${asset.path}">${asset.name}</option>`))
      .join('');
    upkeepBackgroundSelect.innerHTML = optionMarkup;
    upkeepBackgroundSelect.value = this.upkeepBackgroundAssetPath;
  }

  async loadUpkeepBackground(path) {
    if (!path) {
      this.upkeepBackgroundImage = null;
      return;
    }
    if (this.upkeepBackgroundCache.has(path)) {
      this.upkeepBackgroundImage = this.upkeepBackgroundCache.get(path);
      return;
    }
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load upkeep background asset'));
      img.src = path;
    });
    this.upkeepBackgroundCache.set(path, image);
    this.upkeepBackgroundImage = image;
  }

  async handleUpkeepBackgroundChange() {
    const selectedPath = this.elements.upkeepBackgroundSelect?.value || '';
    this.upkeepBackgroundAssetPath = selectedPath;
    try {
      await this.loadUpkeepBackground(selectedPath);
    } catch (error) {
      this.upkeepBackgroundImage = null;
    }
    if (this.upkeepDisplay?.value != null) {
      this.drawUpkeepDisplay(this.upkeepDisplay.value);
    }
  }

  exportUpkeepPosition() {
    const { upkeepExportOutputEl } = this.elements;
    const serialized = JSON.stringify({
      position: this.upkeepPosition,
      panelSize: this.upkeepPanelSize,
      textPosition: this.upkeepTextPosition,
      backgroundAssetPath: this.upkeepBackgroundAssetPath,
    });
    if (upkeepExportOutputEl) upkeepExportOutputEl.textContent = serialized;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(serialized).catch(() => {});
    }
  }

  start() {
    const {
      matchmakingBtn,
      readyBtn,
      resetBtn,
      upkeepXInput,
      upkeepYInput,
      upkeepZInput,
      upkeepWidthInput,
      upkeepHeightInput,
      upkeepTextXInput,
      upkeepTextYInput,
      upkeepBackgroundSelect,
      upkeepExportBtn,
    } = this.elements;
    matchmakingBtn.addEventListener('click', this.beginMatchmaking);
    readyBtn.addEventListener('click', this.readyUp);
    resetBtn.addEventListener('click', this.resetMatch);
    upkeepXInput?.addEventListener('input', this.handleUpkeepPositionInput);
    upkeepYInput?.addEventListener('input', this.handleUpkeepPositionInput);
    upkeepZInput?.addEventListener('input', this.handleUpkeepPositionInput);
    upkeepWidthInput?.addEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepHeightInput?.addEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepTextXInput?.addEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepTextYInput?.addEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepBackgroundSelect?.addEventListener('change', this.handleUpkeepBackgroundChange);
    upkeepExportBtn?.addEventListener('click', this.exportUpkeepPosition);
    window.addEventListener('resize', this.handleWindowResize);
    this.syncUpkeepPositionInputs();
    this.syncUpkeepBackgroundOptions();
    this.fetchUpkeepAssets();
    this.renderMatch();
    this.matchmakingPollTimer = window.setInterval(() => this.pollMatchmakingStatus(), this.options.pollIntervalMs);
    this.pollMatchmakingStatus();
  }

  destroy() {
    const {
      matchmakingBtn,
      readyBtn,
      resetBtn,
      upkeepXInput,
      upkeepYInput,
      upkeepZInput,
      upkeepWidthInput,
      upkeepHeightInput,
      upkeepTextXInput,
      upkeepTextYInput,
      upkeepBackgroundSelect,
      upkeepExportBtn,
    } = this.elements;
    this.stopMatchmakingPolling();
    matchmakingBtn.removeEventListener('click', this.beginMatchmaking);
    readyBtn.removeEventListener('click', this.readyUp);
    resetBtn.removeEventListener('click', this.resetMatch);
    upkeepXInput?.removeEventListener('input', this.handleUpkeepPositionInput);
    upkeepYInput?.removeEventListener('input', this.handleUpkeepPositionInput);
    upkeepZInput?.removeEventListener('input', this.handleUpkeepPositionInput);
    upkeepWidthInput?.removeEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepHeightInput?.removeEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepTextXInput?.removeEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepTextYInput?.removeEventListener('input', this.handleUpkeepPanelStyleInput);
    upkeepBackgroundSelect?.removeEventListener('change', this.handleUpkeepBackgroundChange);
    upkeepExportBtn?.removeEventListener('click', this.exportUpkeepPosition);
    window.removeEventListener('resize', this.handleWindowResize);
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.cardRollerOverlay) {
      this.cardRollerOverlay.destroy();
      this.cardRollerOverlay = null;
    }
    this.teardownUpkeepDisplay();
  }

  createUpkeepTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = UPKEEP_TEXT_CANVAS_SIZE.width;
    canvas.height = UPKEEP_TEXT_CANVAS_SIZE.height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return { canvas, texture };
  }

  ensureUpkeepDisplay() {
    if (!this.client?.camera || !this.client?.scene) return;
    if (this.upkeepDisplay) return;

    // The upkeep panel is attached to the camera so it behaves like a HUD card.
    // Ensure the camera is in the scene graph, otherwise camera children are not rendered.
    if (this.client.camera.parent !== this.client.scene) {
      this.client.scene.add(this.client.camera);
    }

    const { canvas: panelCanvas, texture: panelTexture } = this.createUpkeepTexture();
    const panelMaterial = new THREE.MeshBasicMaterial({
      map: panelTexture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(DEFAULT_UPKEEP_PANEL_SIZE.width, DEFAULT_UPKEEP_PANEL_SIZE.height), panelMaterial);
    panelMesh.renderOrder = 1000;
    this.client.camera.add(panelMesh);

    const { canvas: textCanvas, texture: textTexture } = this.createUpkeepTexture();
    const textMaterial = new THREE.MeshBasicMaterial({
      map: textTexture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(DEFAULT_UPKEEP_PANEL_SIZE.width, DEFAULT_UPKEEP_PANEL_SIZE.height), textMaterial);
    textMesh.renderOrder = 1001;
    this.client.camera.add(textMesh);

    this.upkeepDisplay = {
      panelCanvas,
      panelTexture,
      panelMaterial,
      panelMesh,
      textCanvas,
      textTexture,
      textMaterial,
      textMesh,
      value: null,
    };
  }

  teardownUpkeepDisplay() {
    if (!this.upkeepDisplay) return;
    const { panelMesh, panelMaterial, panelTexture, textMesh, textMaterial, textTexture } = this.upkeepDisplay;
    panelMesh.parent?.remove(panelMesh);
    panelMesh.geometry.dispose();
    panelMaterial.dispose();
    panelTexture.dispose();
    textMesh.parent?.remove(textMesh);
    textMesh.geometry.dispose();
    textMaterial.dispose();
    textTexture.dispose();
    this.upkeepDisplay = null;
  }

  positionUpkeepDisplay() {
    if (!this.upkeepDisplay || !this.client?.camera) return;
    const { panelMesh, textMesh } = this.upkeepDisplay;
    const depth = Math.max(Math.abs(this.upkeepPosition.z), 0.001);
    const referenceFrustum = getFrustumHalfExtents(UPKEEP_REFERENCE_CAMERA.fov, UPKEEP_REFERENCE_CAMERA.aspect, depth);
    const currentFrustum = getFrustumHalfExtents(this.client.camera.fov, this.client.camera.aspect, depth);
    const normalizedX = this.upkeepPosition.x / referenceFrustum.halfWidth;
    const normalizedY = this.upkeepPosition.y / referenceFrustum.halfHeight;
    const x = normalizedX * currentFrustum.halfWidth;
    const y = normalizedY * currentFrustum.halfHeight;
    const scaleFactor = currentFrustum.halfHeight / referenceFrustum.halfHeight;
    const widthScale = this.upkeepPanelSize.width / DEFAULT_UPKEEP_PANEL_SIZE.width;
    const heightScale = this.upkeepPanelSize.height / DEFAULT_UPKEEP_PANEL_SIZE.height;
    panelMesh.position.set(x, y, this.upkeepPosition.z);
    panelMesh.scale.set(scaleFactor * widthScale, scaleFactor * heightScale, 1);
    panelMesh.rotation.set(0, 0, 0);

    const textOffsetX = this.upkeepPanelSize.width * this.upkeepTextPosition.x * scaleFactor;
    const textOffsetY = this.upkeepPanelSize.height * this.upkeepTextPosition.y * scaleFactor;
    textMesh.position.set(x + textOffsetX, y + textOffsetY, this.upkeepPosition.z + 0.001);
    textMesh.scale.set(scaleFactor, scaleFactor, 1);
    textMesh.rotation.set(0, 0, 0);
  }

  drawUpkeepDisplay(upkeepValue) {
    if (!this.upkeepDisplay) return;
    const {
      panelCanvas,
      panelTexture,
      textCanvas,
      textTexture,
    } = this.upkeepDisplay;
    const panelCtx = panelCanvas.getContext('2d');
    const textCtx = textCanvas.getContext('2d');
    if (!panelCtx || !textCtx) return;

    panelCtx.clearRect(0, 0, panelCanvas.width, panelCanvas.height);
    textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);

    if (this.upkeepBackgroundImage) {
      panelCtx.drawImage(this.upkeepBackgroundImage, 0, 0, panelCanvas.width, panelCanvas.height);
    } else {
      const panelPadding = 14;
      const panelRadius = 24;
      const panelX = panelPadding;
      const panelY = panelPadding;
      const panelWidth = panelCanvas.width - (panelPadding * 2);
      const panelHeight = panelCanvas.height - (panelPadding * 2);

      panelCtx.beginPath();
      panelCtx.roundRect(panelX, panelY, panelWidth, panelHeight, panelRadius);
      panelCtx.fillStyle = 'rgba(8, 11, 18, 0.72)';
      panelCtx.fill();
      panelCtx.lineWidth = 5;
      panelCtx.strokeStyle = 'rgba(190, 210, 255, 0.55)';
      panelCtx.stroke();
    }

    textCtx.font = '900 126px Arial, sans-serif';
    textCtx.textAlign = 'center';
    textCtx.textBaseline = 'middle';
    textCtx.lineJoin = 'round';
    textCtx.lineWidth = 16;
    textCtx.strokeStyle = '#000000';
    textCtx.fillStyle = '#ffffff';

    const text = `${upkeepValue}`;
    const x = textCanvas.width * 0.5;
    const y = textCanvas.height * 0.5;
    textCtx.strokeText(text, x, y);
    textCtx.fillText(text, x, y);

    panelTexture.needsUpdate = true;
    textTexture.needsUpdate = true;
    this.upkeepDisplay.value = upkeepValue;
  }

  syncUpkeepDisplay() {
    if (!this.client || !this.match) return;
    const upkeepValue = Number.isInteger(this.match.upkeep) ? this.match.upkeep : 1;
    this.ensureUpkeepDisplay();
    this.positionUpkeepDisplay();
    if (this.upkeepDisplay?.value !== upkeepValue) {
      this.drawUpkeepDisplay(upkeepValue);
    }
  }

  stopMatchmakingPolling() {
    if (this.matchmakingPollTimer) {
      window.clearInterval(this.matchmakingPollTimer);
      this.matchmakingPollTimer = 0;
    }
  }

  getBoardSlotLayout() {
    return [
      { x: -1.05, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.BOARD },
      { x: 1.05, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.BOARD },
      { x: 3.15, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.BOARD },
      { x: -1.05, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.BOARD },
      { x: 1.05, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.BOARD },
      { x: 3.15, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.BOARD },
    ];
  }

  getDeckSlotLayout() {
    return [
      { x: -3.15, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.DECK },
      { x: -3.15, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.DECK },
    ];
  }

  getHiddenZoneLayout() {
    const hiddenZones = [CARD_ZONE_TYPES.DISCARD, CARD_ZONE_TYPES.EXILE, CARD_ZONE_TYPES.STAGING, CARD_ZONE_TYPES.STACK, CARD_ZONE_TYPES.RESOLVING];
    return [
      ...hiddenZones.map((zone) => ({ side: PLAYER_SIDE, zone })),
      ...hiddenZones.map((zone) => ({ side: OPPONENT_SIDE, zone })),
    ];
  }

  buildTemplateFromMatch(currentMatch) {
    const animatedDrawCardIds = new Set(currentMatch.meta?.animatedDrawCardIds || []);
    const initialCards = [];

    currentMatch.players[OPPONENT_SIDE].board.forEach((card, index) => {
      const slotIndex = Number.isInteger(card.slotIndex) ? card.slotIndex : index;
      initialCards.push({
        id: card.id,
        color: card.color,
        owner: OPPONENT_SIDE,
        zone: CARD_ZONE_TYPES.BOARD,
        slotIndex,
        canAttack: false,
        attackCommitted: false,
        targetSlotIndex: null,
        catalogCard: card.catalogCard || null,
      });
    });

    currentMatch.players[PLAYER_SIDE].board.forEach((card, index) => {
      const relativeSlotIndex = Number.isInteger(card.slotIndex) ? card.slotIndex : index;
      const localTargetSlotIndex = Number.isInteger(card.targetSlotIndex) ? card.targetSlotIndex : null;
      const targetSlotIndex = localTargetSlotIndex == null
        ? null
        : (card.targetSide === PLAYER_SIDE ? BOARD_SLOTS_PER_SIDE + localTargetSlotIndex : localTargetSlotIndex);
      initialCards.push({
        id: card.id,
        color: card.color,
        owner: PLAYER_SIDE,
        zone: CARD_ZONE_TYPES.BOARD,
        slotIndex: BOARD_SLOTS_PER_SIDE + relativeSlotIndex,
        canAttack: card.canAttack === true,
        attackCommitted: card.attackCommitted === true,
        selectedAbilityIndex: Number.isInteger(card.selectedAbilityIndex) ? card.selectedAbilityIndex : null,
        committedAbilityIndex: card.attackCommitted === true && Number.isInteger(card.selectedAbilityIndex)
          ? card.selectedAbilityIndex
          : null,
        targetSlotIndex,
        targetSide: card.targetSide || null,
        catalogCard: card.catalogCard || null,
      });
    });

    currentMatch.players[PLAYER_SIDE].hand.forEach((card, handIndex) => {
      initialCards.push({
        id: card.id,
        color: card.color,
        owner: PLAYER_SIDE,
        zone: CARD_ZONE_TYPES.HAND,
        dealOrder: animatedDrawCardIds.has(card.id) ? handIndex : null,
        shouldDealAnimate: animatedDrawCardIds.has(card.id),
        catalogCard: card.catalogCard || null,
      });
    });

    (currentMatch.players[PLAYER_SIDE].discard || []).forEach((card) => {
      initialCards.push({
        id: card.id,
        color: card.color,
        owner: PLAYER_SIDE,
        zone: CARD_ZONE_TYPES.DISCARD,
        slotIndex: null,
        catalogCard: card.catalogCard || null,
      });
    });

    (currentMatch.players[OPPONENT_SIDE].discard || []).forEach((card) => {
      initialCards.push({
        id: card.id,
        color: card.color,
        owner: OPPONENT_SIDE,
        zone: CARD_ZONE_TYPES.DISCARD,
        slotIndex: null,
        catalogCard: card.catalogCard || null,
      });
    });

    return {
      playerSide: PLAYER_SIDE,
      zoneFramework: DEFAULT_ZONE_FRAMEWORK,
      boardSlotLayout: this.getBoardSlotLayout(),
      deckSlotLayout: this.getDeckSlotLayout(),
      hiddenZoneLayout: this.getHiddenZoneLayout(),
      initialCards,
    };
  }

  syncPlayerStateFromClient() {
    if (!this.client || !this.match) return { hand: [], board: [], discard: [], attacks: [] };

    const rawCards = typeof this.client.getCardsForSync === 'function'
      ? this.client.getCardsForSync()
      : this.client.cards
        .map((card) => ({
          id: card.userData.cardId,
          color: card.userData.mesh.material.color.getHex(),
          zone: card.userData.zone,
          slotIndex: card.userData.slotIndex,
          owner: card.userData.owner,
        }));

    const allPlayerCards = rawCards
      .filter((card) => card.owner === PLAYER_SIDE)
      .map(({ id, color, zone, slotIndex }) => ({ id, color, zone, slotIndex }));

    const hand = allPlayerCards
      .filter((card) => card.zone === CARD_ZONE_TYPES.HAND)
      .map(({ id, color }) => ({ id, color }));

    const board = allPlayerCards
      .filter((card) => card.zone === CARD_ZONE_TYPES.BOARD)
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map(({ id, color, slotIndex }) => ({ id, color, slotIndex: slotIndex - BOARD_SLOTS_PER_SIDE }));

    const discard = allPlayerCards
      .filter((card) => card.zone === CARD_ZONE_TYPES.DISCARD)
      .map(({ id, color }) => ({ id, color }));

    const attacks = typeof this.client.getCombatDecisions === 'function' ? this.client.getCombatDecisions() : [];

    return { hand, board, discard, attacks };
  }

  getActiveSpellResolution() {
    return this.match?.meta?.activeSpellResolution || null;
  }

  async requestSpellResolutionStart({ card, targetCard, selectedAbility, rollType, dieSides }) {
    const targetSlotIndex = Number.isInteger(targetCard?.userData?.slotIndex)
      ? (targetCard.userData.owner === PLAYER_SIDE ? targetCard.userData.slotIndex - BOARD_SLOTS_PER_SIDE : targetCard.userData.slotIndex)
      : null;
    const targetSide = targetCard?.userData?.owner || null;
    const status = await this.postJson('/api/phase-manager/match/spell/start', {
      playerId: this.playerId,
      cardId: card?.userData?.cardId,
      selectedAbilityIndex: Number.isInteger(card?.userData?.selectedAbilityIndex) ? card.userData.selectedAbilityIndex : 0,
      targetSlotIndex,
      targetSide,
      rollType,
      dieSides,
    });
    this.match = status.matchState || this.match;
    return this.match?.meta?.activeSpellResolution || null;
  }

  async submitSpellRoll({ spellId, rollOutcome, rollData = null }) {
    const status = await this.postJson('/api/phase-manager/match/spell/roll', {
      playerId: this.playerId,
      spellId,
      rollOutcome,
      rollData,
    });
    this.match = status.matchState || this.match;
  }

  async completeSpellResolution({ spellId }) {
    const status = await this.postJson('/api/phase-manager/match/spell/complete', {
      playerId: this.playerId,
      spellId,
    });
    this.match = status.matchState || this.match;
  }

  setReadyLockState() {
    const { readyBtn } = this.elements;
    const isDecisionPhase = Boolean(this.match) && this.match.phase === 1;
    const playerIsReady = Boolean(this.match?.youAreReady);
    const activeSpell = this.getActiveSpellResolution();
    const spellLocked = Boolean(activeSpell && activeSpell.completedAt == null);
    const canInteract = isDecisionPhase && !playerIsReady && !spellLocked;

    readyBtn.disabled = !canInteract;
    if (!this.client) return;

    this.client.options = {
      ...this.client.options,
      interactionLocked: !canInteract,
    };
  }

  updateSummaryPanels() {
    const { overlayEl, matchLabelEl, playerSummaryEl, opponentSummaryEl } = this.elements;
    if (!this.match) {
      overlayEl.hidden = false;
      overlayEl.textContent = 'Start matchmaking to begin a match.';
      matchLabelEl.textContent = 'No active match';
      playerSummaryEl.textContent = 'Player: waiting for matchmaking';
      opponentSummaryEl.textContent = 'Opponent: waiting for matchmaking';
      return;
    }

    const player = this.match.players.player;
    const opponent = this.match.players.opponent;

    overlayEl.hidden = true;
    overlayEl.style.pointerEvents = 'auto';
    if (this.match.youAreReady && this.match.phase !== 2) {
      overlayEl.hidden = false;
      overlayEl.textContent = 'Waiting for opponent to ready…';
    }

    matchLabelEl.textContent = `${this.match.id} • Turn ${this.match.turnNumber} • Phase ${this.match.phase} (${getPhaseLabel(this.match.phase)})`;
    playerSummaryEl.textContent = `You — hand: ${player.hand.length}, board: ${player.board.length}, deck: ${player.deckCount}${this.match.phase === 1 ? `, ready: ${this.match.youAreReady ? 'yes' : 'no'}` : ''}`;
    opponentSummaryEl.textContent = `Opponent — hand: ${opponent.hand.length}, board: ${opponent.board.length}, deck: ${opponent.deckCount}${this.match.phase === 1 ? `, ready: ${this.match.opponentIsReady ? 'yes' : 'no'}` : ''}`;
  }

  updateQueueSummary(status) {
    const { queueSummaryEl } = this.elements;
    if (!status) {
      queueSummaryEl.textContent = 'Queue: idle';
      return;
    }

    if (status.status === 'searching') {
      const positionText = status.queuePosition ? ` (you are #${status.queuePosition})` : '';
      queueSummaryEl.textContent = `Queue: ${status.queueCount} waiting${positionText}`;
      return;
    }

    if (status.status === 'matched') {
      queueSummaryEl.textContent = `Queue: matched in ${status.matchId}`;
      return;
    }

    queueSummaryEl.textContent = `Queue: ${status.queueCount ?? 0} waiting`;
  }

  triggerRemoteSpellPlayback() {
    const activeSpell = this.getActiveSpellResolution();
    const isUnplayedOpponentSpell = activeSpell
      && activeSpell.casterSide === OPPONENT_SIDE
      && !this.playedRemoteSpellResolutionIds.has(activeSpell.id);
    const isOpponentCasting = isUnplayedOpponentSpell
      && this.client?.state?.activeSpellResolutionId !== activeSpell.id;
    if (isOpponentCasting && typeof this.client?.playRemoteSpellResolution === 'function') {
      this.client.playRemoteSpellResolution(activeSpell).then((played) => {
        if (!played) return;
        this.playedRemoteSpellResolutionIds.add(activeSpell.id);
        // Remote spell playback can run while scene refreshes are intentionally paused.
        // Force a post-playback render so both players reconcile to server-authoritative
        // card health/board state even if no new polling delta arrives afterwards.
        if (this.match) this.renderMatch();
      }).catch((error) => {
        this.elements.statusEl.textContent = `Spell sync error: ${error.message}`;
      });
    }
  }

  renderMatch() {
    const { canvas, statusEl } = this.elements;
    if (!this.match) {
      statusEl.textContent = 'Click matchmaking to create a 1v1 phase test.';
      this.teardownUpkeepDisplay();
      this.setReadyLockState();
      this.updateSummaryPanels();
      return;
    }

    const template = this.buildTemplateFromMatch(this.match);
    const shouldAnimateInitialDeal = this.match.id !== this.lastAnimatedMatchId;
    const turnAnimationKey = `${this.match.id}:${this.match.turnNumber}`;
    const shouldAnimateTurnDraw = Boolean(this.match.meta?.animatedDrawCardIds?.length) && turnAnimationKey !== this.lastAnimatedTurnKey;
    template.meta = {
      animateInitialDeal: shouldAnimateInitialDeal,
      animateTurnDraw: shouldAnimateTurnDraw,
    };
    if (!this.client) {
      this.client = new CardGameClient({
        canvas,
        statusElement: statusEl,
        template,
        options: {
          onCardStateCommitted: () => this.syncMatchStateAfterCardCommit(),
          onSpellResolutionRequested: (payload) => this.requestSpellResolutionStart(payload),
          onSpellRollResolved: ({ spellId, rollOutcome, rollData }) => this.submitSpellRoll({ spellId, rollOutcome, rollData }),
          onSpellResolutionFinished: ({ spellId }) => this.completeSpellResolution({ spellId }),
          getSpellResolutionSnapshot: () => this.getActiveSpellResolution(),
          previewTuning: this.previewTuning,
          cardAnimationHooks: [
            createDeckToHandDealHook({
              owner: PLAYER_SIDE,
              shouldAnimate: (card, context) => {
                if (context.template?.meta?.animateInitialDeal === true) return true;
                if (context.template?.meta?.animateTurnDraw === true) return card.userData.shouldDealAnimate === true;
                return false;
              },
              durationMs: 980,
              staggerMs: 105,
              arcHeight: 0.95,
              swirlAmplitude: 0.14,
            }),
          ],
        },
      });
      this.cardRollerOverlay = new CardRollerOverlay({
        host: canvas.parentElement,
        cardGameClient: this.client,
      });
      this.client.setPreviewTuning(this.previewTuning);
    } else {
      this.client.template = template;
      this.client.resetDemo();
      this.client.setPreviewTuning(this.previewTuning);
    }

    this.syncUpkeepDisplay();

    if (shouldAnimateInitialDeal) this.lastAnimatedMatchId = this.match.id;
    if (shouldAnimateTurnDraw) this.lastAnimatedTurnKey = turnAnimationKey;

    const commitAnimationKey = `${this.match.id}:${this.match.turnNumber}:${this.match.phase}`;
    const commitAttacks = Array.isArray(this.match.meta?.commitAttacks) ? this.match.meta.commitAttacks : [];
    if (this.match.phase !== 2) {
      this.activeCommitSequenceKey = null;
      this.commitSequencePromise = null;
      this.cardRollerOverlay?.clear();
      this.client?.clearCardStatDisplayOverrides?.();
    } else if (
      this.client
      && typeof this.client.playCommitPhaseAnimations === 'function'
      && commitAnimationKey !== this.lastAnimatedCommitKey
      && !this.commitSequencePromise
    ) {
      this.activeCommitSequenceKey = commitAnimationKey;
      this.commitSequencePromise = this.runCommitSequence(commitAttacks, commitAnimationKey)
        .finally(() => {
          if (this.activeCommitSequenceKey === commitAnimationKey) {
            this.activeCommitSequenceKey = null;
            this.commitSequencePromise = null;
          }
        });
    }

    this.triggerRemoteSpellPlayback();

    statusEl.textContent = this.match.phase === 1
      ? (this.match.youAreReady
        ? 'You are readied up. Waiting for opponent to ready…'
        : 'Decision phase: click/tap a ready board card to preview it, choose an ability, then choose a valid target and click Ready Up.')
      : 'Commit phase: roll each die overlay to resolve attacks.';

    this.setReadyLockState();
    this.updateSummaryPanels();
  }


  getCommitRollByAttackId(attackId, rollType = null) {
    if (!this.match || typeof attackId !== 'string') return null;
    const commitRolls = Array.isArray(this.match.meta?.commitRolls) ? this.match.meta.commitRolls : [];
    return commitRolls.find((entry) => entry?.attackId === attackId && (rollType ? entry?.rollType === rollType : true)) || null;
  }

  async submitCommitRoll({ attackId, rollType, sides, roll }) {
    await this.postJson('/api/phase-manager/match/commit-roll', {
      playerId: this.playerId,
      attackId,
      rollType,
      sides,
      roll,
    });
  }

  async waitForRemoteAttackRoll(attackId, rollType = null) {
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const existing = this.getCommitRollByAttackId(attackId, rollType);
      if (existing?.roll) return existing;

      try {
        const status = await this.getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(this.playerId)}`);
        if (status?.matchState) {
          this.applyMatchmakingStatus(status);
        }
        const remoteRolls = Array.isArray(status?.matchState?.meta?.commitRolls) ? status.matchState.meta.commitRolls : [];
        const matched = remoteRolls.find((entry) => entry?.attackId === attackId && (rollType ? entry?.rollType === rollType : true));
        if (matched?.roll) return matched;
        if (status?.matchState?.phase !== 2) return null;
      } catch (error) {
        this.elements.statusEl.textContent = `Commit roll polling error: ${error.message}`;
        return null;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    return null;
  }

  async runCommitSequence(commitAttacks, commitAnimationKey) {
    if (this.activeCommitSequenceKey && this.activeCommitSequenceKey !== commitAnimationKey) {
      return;
    }

    if (this.cardRollerOverlay) {
      try {
        await this.cardRollerOverlay.rollForAttacks(commitAttacks, {
          rollSequence: ['damage', 'speed', 'defense'],
          canControlAttack: (attack) => attack?.attackerSide === PLAYER_SIDE,
          onAttackRoll: ({ attack, rollType, sides, roll }) => this.submitCommitRoll({
            attackId: attack?.id,
            rollType,
            sides,
            roll,
          }),
          waitForRemoteRoll: (attack, rollType) => this.waitForRemoteAttackRoll(attack?.id, rollType),
        });
      } catch (error) {
        this.elements.statusEl.textContent = `Dice roll error: ${error.message}`;
        this.cardRollerOverlay.clear();
        return;
      }
    }

    try {
      await this.postJson('/api/phase-manager/match/commit-complete', {
        playerId: this.playerId,
      });
    } catch (error) {
      this.elements.statusEl.textContent = `Commit sync error: ${error.message}`;
      return;
    }

    const allRolledAt = await this.waitForCommitAllRolledAt();
    if (!allRolledAt) return;

    const latestCommitAttacks = await this.fetchLatestCommitAttacks();
    const attackPlanToAnimate = latestCommitAttacks || commitAttacks;

    await new Promise((resolve) => {
      this.client.playCommitPhaseAnimations(attackPlanToAnimate, {
        interAttackDelayMs: 740,
        onDone: resolve,
      });
    });

    try {
      await this.postJson('/api/phase-manager/match/commit-animation-complete', {
        playerId: this.playerId,
      });
    } catch (error) {
      this.elements.statusEl.textContent = `Commit animation sync error: ${error.message}`;
      return;
    }

    this.lastAnimatedCommitKey = commitAnimationKey;
  }


  async fetchLatestCommitAttacks() {
    try {
      const status = await this.getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(this.playerId)}`);
      const commitAttacks = Array.isArray(status?.matchState?.meta?.commitAttacks) ? status.matchState.meta.commitAttacks : null;
      return commitAttacks;
    } catch (error) {
      return null;
    }
  }

  async waitForCommitAllRolledAt() {
    const maxAttempts = 45;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const status = await this.getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(this.playerId)}`);
        const commitAllRolledAt = status?.matchState?.meta?.commitAllRolledAt;
        if (Number.isFinite(commitAllRolledAt)) return commitAllRolledAt;
        if (status?.matchState?.phase !== 2) return null;
      } catch (error) {
        this.elements.statusEl.textContent = `Commit polling error: ${error.message}`;
        return null;
      }
      await new Promise((resolve) => window.setTimeout(resolve, this.options.pollIntervalMs));
    }
    return null;
  }

  async syncMatchStateAfterCardCommit() {
    const { statusEl } = this.elements;
    if (!this.match || this.match.phase !== 1 || this.match.youAreReady || this.stateSyncInFlight) return;

    const nextState = this.syncPlayerStateFromClient();
    this.stateSyncInFlight = true;
    try {
      const status = await this.postJson('/api/phase-manager/match/sync-state', {
        playerId: this.playerId,
        hand: nextState.hand,
        board: nextState.board,
        discard: nextState.discard,
        attacks: nextState.attacks,
      });
      this.applyMatchmakingStatus(status);
    } catch (error) {
      statusEl.textContent = `Card sync error: ${error.message}`;
    } finally {
      this.stateSyncInFlight = false;
    }
  }

  applyMatchmakingStatus(status) {
    const { matchmakingBtn, statusEl } = this.elements;
    this.updateQueueSummary(status);

    if (status.status === 'matched') {
      matchmakingBtn.disabled = true;
      matchmakingBtn.textContent = 'Match Found';

      const nextMatch = status.matchState || null;
      if (nextMatch && this.match) {
        const isNewTurn = nextMatch.turnNumber > this.match.turnNumber && nextMatch.phase === 1;
        const drawnCardIds = Array.isArray(nextMatch.meta?.drawnCardIds) ? nextMatch.meta.drawnCardIds : [];
        const previousAnimatedDrawCardIds = Array.isArray(this.match.meta?.animatedDrawCardIds)
          ? this.match.meta.animatedDrawCardIds
          : [];
        nextMatch.meta = {
          ...nextMatch.meta,
          animatedDrawCardIds: isNewTurn ? drawnCardIds : previousAnimatedDrawCardIds,
        };
      }

      if (nextMatch && !this.match) {
        nextMatch.meta = {
          ...nextMatch.meta,
          animatedDrawCardIds: [],
        };
      }

      const shouldRefreshScene = this.shouldRefreshMatchScene(nextMatch);
      const nextSerialized = JSON.stringify(nextMatch);
      const currentSerialized = JSON.stringify(this.match);
      if (nextSerialized !== currentSerialized) {
        this.match = nextMatch;
        if (shouldRefreshScene) {
          this.renderMatch();
        } else {
          this.setReadyLockState();
          this.updateSummaryPanels();
          this.triggerRemoteSpellPlayback();
        }
      } else {
        this.setReadyLockState();
        this.updateSummaryPanels();
        this.triggerRemoteSpellPlayback();
      }
      return;
    }

    this.match = null;
    this.lastAnimatedMatchId = null;
    this.lastAnimatedTurnKey = null;
    this.lastAnimatedCommitKey = null;
    this.commitSequencePromise = null;
    this.playedRemoteSpellResolutionIds.clear();
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.cardRollerOverlay) {
      this.cardRollerOverlay.destroy();
      this.cardRollerOverlay = null;
    }

    if (status.status === 'searching') {
      statusEl.textContent = 'Looking for match... Waiting for another player to queue.';
      matchmakingBtn.disabled = true;
      matchmakingBtn.textContent = 'Searching...';
      this.setReadyLockState();
      this.updateSummaryPanels();
      return;
    }

    matchmakingBtn.disabled = false;
    matchmakingBtn.textContent = 'Find Match';
    this.renderMatch();
  }

  shouldRefreshMatchScene(nextMatch) {
    if (!nextMatch || !this.match) return true;

    const isSameCommitTurn = this.match.id === nextMatch.id
      && this.match.turnNumber === nextMatch.turnNumber
      && this.match.phase === 2
      && nextMatch.phase === 2;

    if (isSameCommitTurn) {
      return false;
    }

    const currentActiveSpell = this.match?.meta?.activeSpellResolution;
    const nextActiveSpell = nextMatch?.meta?.activeSpellResolution;
    const awaitingRemoteSpellPlayback = Boolean(
      nextActiveSpell
      && nextActiveSpell.casterSide === OPPONENT_SIDE
      && !this.playedRemoteSpellResolutionIds.has(nextActiveSpell.id),
    );
    const spellResolutionInProgress = Boolean(nextActiveSpell && nextActiveSpell.completedAt == null);
    const isSameDecisionTurn = this.match.id === nextMatch.id
      && this.match.turnNumber === nextMatch.turnNumber
      && this.match.phase === 1
      && nextMatch.phase === 1;
    if (isSameDecisionTurn && (spellResolutionInProgress || awaitingRemoteSpellPlayback)) {
      return false;
    }

    return true;
  }

  async pollMatchmakingStatus() {
    const { statusEl } = this.elements;
    try {
      const status = await this.getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(this.playerId)}`);
      this.applyMatchmakingStatus(status);
    } catch (error) {
      statusEl.textContent = `Matchmaking status error: ${error.message}`;
    }
  }

  beginMatchmaking() {
    const { matchmakingBtn, statusEl } = this.elements;
    if (this.match) return;

    this.postJson('/api/phase-manager/matchmaking/find', { playerId: this.playerId })
      .then((status) => {
        this.applyMatchmakingStatus(status);
        if (!this.matchmakingPollTimer) {
          this.matchmakingPollTimer = window.setInterval(() => this.pollMatchmakingStatus(), this.options.pollIntervalMs);
        }
      })
      .catch((error) => {
        statusEl.textContent = `Matchmaking failed: ${error.message}`;
        matchmakingBtn.disabled = false;
        matchmakingBtn.textContent = 'Find Match';
      });
  }

  readyUp() {
    const { readyBtn, statusEl } = this.elements;
    if (!this.match || this.match.phase !== 1 || this.match.youAreReady) return;

    const nextState = this.syncPlayerStateFromClient();
    readyBtn.disabled = true;

    this.postJson('/api/phase-manager/match/ready', {
      playerId: this.playerId,
      hand: nextState.hand,
      board: nextState.board,
      discard: nextState.discard,
      attacks: nextState.attacks,
    })
      .then((status) => {
        this.applyMatchmakingStatus(status);
      })
      .catch((error) => {
        statusEl.textContent = `Ready up error: ${error.message}`;
        this.setReadyLockState();
      });
  }

  resetMatch() {
    const { matchmakingBtn, statusEl } = this.elements;
    this.stopMatchmakingPolling();

    this.match = null;
    this.lastAnimatedMatchId = null;
    this.lastAnimatedTurnKey = null;
    this.lastAnimatedCommitKey = null;
    this.commitSequencePromise = null;
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.cardRollerOverlay) {
      this.cardRollerOverlay.destroy();
      this.cardRollerOverlay = null;
    }

    this.postJson('/api/phase-manager/matchmaking/reset', { playerId: this.playerId })
      .then((status) => {
        this.updateQueueSummary(status);
        matchmakingBtn.disabled = false;
        matchmakingBtn.textContent = 'Find Match';
        this.matchmakingPollTimer = window.setInterval(() => this.pollMatchmakingStatus(), this.options.pollIntervalMs);
      })
      .catch((error) => {
        statusEl.textContent = `Reset error: ${error.message}`;
      });

    this.renderMatch();
  }
}
