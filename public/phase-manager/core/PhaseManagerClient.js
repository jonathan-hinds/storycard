import { CardGameClient, CARD_ZONE_TYPES, DEFAULT_ZONE_FRAMEWORK, createDeckToHandDealHook, loadPreviewTuning } from '/public/card-game/index.js';
import { CardRollerOverlay } from './CardRollerOverlay.js';
import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const PLAYER_SIDE = 'player';
const OPPONENT_SIDE = 'opponent';
const BOARD_SLOTS_PER_SIDE = 3;
const UPKEEP_PANEL_CANVAS_SIZE = { width: 2368, height: 200 };
const READY_PANEL_CANVAS_SIZE = { width: 1024, height: 256 };
const DEFAULT_UPKEEP_PANEL_SIZE = { width: 3.55, height: 0.3 };
const DEFAULT_UPKEEP_POSITION = { x: 0.775, y: 0.07, z: -5.49 };
const DEFAULT_UPKEEP_TEXT_POSITION = { x: -0.29, y: -0.05 };
const DEFAULT_UPKEEP_TEXT_SCALE = 0.35;
const DEFAULT_UPKEEP_BACKGROUND_ASSET_PATH = '/public/assets/upkeep2.png';
const DEFAULT_READY_BUTTON_PANEL_SIZE = { width: 1.1, height: 0.3 };
const DEFAULT_READY_BUTTON_POSITION = { x: 0.912, y: 0.91, z: -6 };
const DEFAULT_READY_BUTTON_TEXT_POSITION = { x: -0.02, y: -0.03 };
const DEFAULT_READY_BUTTON_TEXT_SCALE = 0.5;
const DEFAULT_READY_BUTTON_BACKGROUND_ASSET_PATH = '/public/assets/readyup2.png';
const UPKEEP_REFERENCE_CAMERA = { fov: 45, aspect: 16 / 9 };
const READY_BUTTON_LABEL = 'READY UP';

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
    this.readyButtonDisplay = null;
    this.upkeepCounterPosition = { ...DEFAULT_UPKEEP_POSITION };
    this.upkeepCounterPanelSize = { ...DEFAULT_UPKEEP_PANEL_SIZE };
    this.upkeepCounterTextPosition = { ...DEFAULT_UPKEEP_TEXT_POSITION };
    this.upkeepCounterTextScale = DEFAULT_UPKEEP_TEXT_SCALE;
    this.upkeepCounterBackgroundAssetPath = DEFAULT_UPKEEP_BACKGROUND_ASSET_PATH;
    this.upkeepCounterBackgroundImage = null;
    this.readyButtonPosition = { ...DEFAULT_READY_BUTTON_POSITION };
    this.readyButtonPanelSize = { ...DEFAULT_READY_BUTTON_PANEL_SIZE };
    this.readyButtonTextPosition = { ...DEFAULT_READY_BUTTON_TEXT_POSITION };
    this.readyButtonTextScale = DEFAULT_READY_BUTTON_TEXT_SCALE;
    this.readyButtonBackgroundAssetPath = DEFAULT_READY_BUTTON_BACKGROUND_ASSET_PATH;
    this.readyButtonBackgroundImage = null;
    this.backgroundAssetCache = new Map();
    this.availableBackgroundAssets = [];
    this.boundControlListeners = [];
    this.playedRemoteSpellResolutionIds = new Set();
    this.previewTuning = loadPreviewTuning();
    this.playerId = createTabPlayerId();

    this.beginMatchmaking = this.beginMatchmaking.bind(this);
    this.readyUp = this.readyUp.bind(this);
    this.resetMatch = this.resetMatch.bind(this);
    this.handleReadyPositionInput = this.handleReadyPositionInput.bind(this);
    this.handleReadyStyleInput = this.handleReadyStyleInput.bind(this);
    this.handleUpkeepCounterInput = this.handleUpkeepCounterInput.bind(this);
    this.handleUpkeepPanelStyleInput = this.handleUpkeepPanelStyleInput.bind(this);
    this.handleReadyBackgroundChange = this.handleReadyBackgroundChange.bind(this);
    this.handleUpkeepBackgroundChange = this.handleUpkeepBackgroundChange.bind(this);
    this.exportLayout = this.exportLayout.bind(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.handleCanvasPointerUp = this.handleCanvasPointerUp.bind(this);
  }

  handleWindowResize() {
    this.positionUpkeepDisplay();
    this.positionReadyButtonDisplay();
    this.syncUpkeepPositionInputs();
    window.requestAnimationFrame(() => {
      this.positionUpkeepDisplay();
      this.positionReadyButtonDisplay();
      this.syncUpkeepPositionInputs();
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

  getUpkeepViewportSize() {
    const rendererSize = this.client?.renderer?.getSize?.(new THREE.Vector2());
    if (rendererSize?.x && rendererSize?.y) {
      return { width: rendererSize.x, height: rendererSize.y };
    }
    const canvasWidth = Number(this.elements.canvas?.clientWidth || this.elements.canvas?.width || 0);
    const canvasHeight = Number(this.elements.canvas?.clientHeight || this.elements.canvas?.height || 0);
    return {
      width: canvasWidth > 0 ? canvasWidth : 1,
      height: canvasHeight > 0 ? canvasHeight : 1,
    };
  }

  syncUpkeepPositionInputs() {
    const viewport = this.getUpkeepViewportSize();
    this.syncControlPair('readyX', this.readyButtonPosition.x, 3, `${Math.round(this.readyButtonPosition.x * viewport.width)}px`);
    this.syncControlPair('readyY', this.readyButtonPosition.y, 3, `${Math.round(this.readyButtonPosition.y * viewport.height)}px`);
    this.syncControlPair('readyZ', this.readyButtonPosition.z, 2);
    this.syncControlPair('readyWidth', this.readyButtonPanelSize.width, 2);
    this.syncControlPair('readyHeight', this.readyButtonPanelSize.height, 2);
    this.syncControlPair('readyTextX', this.readyButtonTextPosition.x, 2);
    this.syncControlPair('readyTextY', this.readyButtonTextPosition.y, 2);
    this.syncControlPair('readyTextSize', this.readyButtonTextScale, 2);

    this.syncControlPair('upkeepX', this.upkeepCounterPosition.x, 3, `${Math.round(this.upkeepCounterPosition.x * viewport.width)}px`);
    this.syncControlPair('upkeepY', this.upkeepCounterPosition.y, 3, `${Math.round(this.upkeepCounterPosition.y * viewport.height)}px`);
    this.syncControlPair('upkeepZ', this.upkeepCounterPosition.z, 2);
    this.syncControlPair('upkeepWidth', this.upkeepCounterPanelSize.width, 2);
    this.syncControlPair('upkeepHeight', this.upkeepCounterPanelSize.height, 2);
    this.syncControlPair('upkeepTextX', this.upkeepCounterTextPosition.x, 2);
    this.syncControlPair('upkeepTextY', this.upkeepCounterTextPosition.y, 2);
    this.syncControlPair('upkeepTextSize', this.upkeepCounterTextScale, 2);
  }

  syncControlPair(prefix, value, decimals = 2, suffix = '') {
    const valueText = Number(value).toFixed(decimals);
    const rangeInput = this.elements[`${prefix}Input`];
    const numberInput = this.elements[`${prefix}NumberInput`];
    const valueEl = this.elements[`${prefix}ValueEl`];
    if (rangeInput) rangeInput.value = valueText;
    if (numberInput) numberInput.value = valueText;
    if (valueEl) valueEl.textContent = suffix ? `${valueText} (${suffix})` : valueText;
  }

  getControlValue(prefix, fallback) {
    return this.parseUpkeepPositionValue(this.elements[`${prefix}Input`]?.value, fallback);
  }

  handleReadyPositionInput() {
    this.readyButtonPosition = {
      x: THREE.MathUtils.clamp(this.getControlValue('readyX', this.readyButtonPosition.x), 0, 1),
      y: THREE.MathUtils.clamp(this.getControlValue('readyY', this.readyButtonPosition.y), 0, 1),
      z: this.getControlValue('readyZ', this.readyButtonPosition.z),
    };
    this.syncUpkeepPositionInputs();
    this.positionReadyButtonDisplay();
  }

  handleReadyStyleInput() {
    this.readyButtonPanelSize = {
      width: this.getControlValue('readyWidth', this.readyButtonPanelSize.width),
      height: this.getControlValue('readyHeight', this.readyButtonPanelSize.height),
    };
    this.readyButtonTextPosition = {
      x: this.getControlValue('readyTextX', this.readyButtonTextPosition.x),
      y: this.getControlValue('readyTextY', this.readyButtonTextPosition.y),
    };
    this.readyButtonTextScale = this.getControlValue('readyTextSize', this.readyButtonTextScale);
    this.syncUpkeepPositionInputs();
    this.positionReadyButtonDisplay();
    this.drawReadyButtonDisplay();
  }

  handleUpkeepCounterInput() {
    this.upkeepCounterPosition = {
      x: THREE.MathUtils.clamp(this.getControlValue('upkeepX', this.upkeepCounterPosition.x), 0, 1),
      y: THREE.MathUtils.clamp(this.getControlValue('upkeepY', this.upkeepCounterPosition.y), 0, 1),
      z: this.getControlValue('upkeepZ', this.upkeepCounterPosition.z),
    };
    this.syncUpkeepPositionInputs();
    this.positionUpkeepDisplay();
  }

  handleUpkeepPanelStyleInput() {
    this.upkeepCounterPanelSize = {
      width: this.getControlValue('upkeepWidth', this.upkeepCounterPanelSize.width),
      height: this.getControlValue('upkeepHeight', this.upkeepCounterPanelSize.height),
    };
    this.upkeepCounterTextPosition = {
      x: this.getControlValue('upkeepTextX', this.upkeepCounterTextPosition.x),
      y: this.getControlValue('upkeepTextY', this.upkeepCounterTextPosition.y),
    };
    this.upkeepCounterTextScale = this.getControlValue('upkeepTextSize', this.upkeepCounterTextScale);
    this.syncUpkeepPositionInputs();
    this.positionUpkeepDisplay();
    this.drawUpkeepDisplay(this.upkeepDisplay?.value ?? 1, this.match?.upkeepTotal ?? 10);
  }

  async fetchUpkeepAssets() {
    try {
      const payload = await this.getJson('/api/assets');
      this.availableBackgroundAssets = Array.isArray(payload?.assets) ? payload.assets : [];
    } catch (error) {
      this.availableBackgroundAssets = [];
    }
    this.syncUpkeepBackgroundOptions();
  }

  syncUpkeepBackgroundOptions() {
    const selects = [this.elements.readyBackgroundSelect, this.elements.upkeepBackgroundSelect].filter(Boolean);
    const optionMarkup = ['<option value="">Default generated panel</option>']
      .concat(this.availableBackgroundAssets.map((asset) => `<option value="${asset.path}">${asset.name}</option>`))
      .join('');
    selects.forEach((select) => {
      select.innerHTML = optionMarkup;
    });
    if (this.elements.readyBackgroundSelect) this.elements.readyBackgroundSelect.value = this.readyButtonBackgroundAssetPath;
    if (this.elements.upkeepBackgroundSelect) this.elements.upkeepBackgroundSelect.value = this.upkeepCounterBackgroundAssetPath;
  }

  async loadBackgroundAsset(path) {
    if (!path) return null;
    if (this.backgroundAssetCache.has(path)) return this.backgroundAssetCache.get(path);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load background asset'));
      img.src = path;
    });
    this.backgroundAssetCache.set(path, image);
    return image;
  }

  async handleReadyBackgroundChange() {
    const selectedPath = this.elements.readyBackgroundSelect?.value || '';
    this.readyButtonBackgroundAssetPath = selectedPath;
    this.readyButtonBackgroundImage = await this.loadBackgroundAsset(selectedPath).catch(() => null);
    this.drawReadyButtonDisplay();
  }

  async handleUpkeepBackgroundChange() {
    const selectedPath = this.elements.upkeepBackgroundSelect?.value || '';
    this.upkeepCounterBackgroundAssetPath = selectedPath;
    this.upkeepCounterBackgroundImage = await this.loadBackgroundAsset(selectedPath).catch(() => null);
    this.drawUpkeepDisplay(this.upkeepDisplay?.value ?? 1, this.match?.upkeepTotal ?? 10);
  }

  exportLayout() {
    const { layoutExportOutputEl } = this.elements;
    const serialized = JSON.stringify({
      readyUp: {
        backgroundAssetPath: this.readyButtonBackgroundAssetPath,
        position: this.readyButtonPosition,
        panelSize: this.readyButtonPanelSize,
        textPosition: this.readyButtonTextPosition,
        textScale: this.readyButtonTextScale,
      },
      upkeep: {
        backgroundAssetPath: this.upkeepCounterBackgroundAssetPath,
        position: this.upkeepCounterPosition,
        panelSize: this.upkeepCounterPanelSize,
        textPosition: this.upkeepCounterTextPosition,
        textScale: this.upkeepCounterTextScale,
      },
    });
    if (layoutExportOutputEl) layoutExportOutputEl.textContent = serialized;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(serialized).catch(() => {});
  }

  bindMirroredInputs(rangeInput, numberInput, callback) {
    if (!rangeInput || !numberInput) return;
    const fromRange = () => {
      numberInput.value = rangeInput.value;
      callback();
    };
    const fromNumber = () => {
      rangeInput.value = numberInput.value;
      callback();
    };
    rangeInput.addEventListener('input', fromRange);
    numberInput.addEventListener('input', fromNumber);
    this.boundControlListeners.push(() => {
      rangeInput.removeEventListener('input', fromRange);
      numberInput.removeEventListener('input', fromNumber);
    });
  }

  start() {
    const { canvas, matchmakingBtn, readyBtn, resetBtn, layoutExportBtn, readyBackgroundSelect, upkeepBackgroundSelect } = this.elements;
    matchmakingBtn.addEventListener('click', this.beginMatchmaking);
    readyBtn.addEventListener('click', this.readyUp);
    readyBtn.hidden = true;
    canvas?.addEventListener('pointerup', this.handleCanvasPointerUp);
    resetBtn.addEventListener('click', this.resetMatch);

    this.bindMirroredInputs(this.elements.readyXInput, this.elements.readyXNumberInput, this.handleReadyPositionInput);
    this.bindMirroredInputs(this.elements.readyYInput, this.elements.readyYNumberInput, this.handleReadyPositionInput);
    this.bindMirroredInputs(this.elements.readyZInput, this.elements.readyZNumberInput, this.handleReadyPositionInput);
    this.bindMirroredInputs(this.elements.readyWidthInput, this.elements.readyWidthNumberInput, this.handleReadyStyleInput);
    this.bindMirroredInputs(this.elements.readyHeightInput, this.elements.readyHeightNumberInput, this.handleReadyStyleInput);
    this.bindMirroredInputs(this.elements.readyTextXInput, this.elements.readyTextXNumberInput, this.handleReadyStyleInput);
    this.bindMirroredInputs(this.elements.readyTextYInput, this.elements.readyTextYNumberInput, this.handleReadyStyleInput);
    this.bindMirroredInputs(this.elements.readyTextSizeInput, this.elements.readyTextSizeNumberInput, this.handleReadyStyleInput);

    this.bindMirroredInputs(this.elements.upkeepXInput, this.elements.upkeepXNumberInput, this.handleUpkeepCounterInput);
    this.bindMirroredInputs(this.elements.upkeepYInput, this.elements.upkeepYNumberInput, this.handleUpkeepCounterInput);
    this.bindMirroredInputs(this.elements.upkeepZInput, this.elements.upkeepZNumberInput, this.handleUpkeepCounterInput);
    this.bindMirroredInputs(this.elements.upkeepWidthInput, this.elements.upkeepWidthNumberInput, this.handleUpkeepPanelStyleInput);
    this.bindMirroredInputs(this.elements.upkeepHeightInput, this.elements.upkeepHeightNumberInput, this.handleUpkeepPanelStyleInput);
    this.bindMirroredInputs(this.elements.upkeepTextXInput, this.elements.upkeepTextXNumberInput, this.handleUpkeepPanelStyleInput);
    this.bindMirroredInputs(this.elements.upkeepTextYInput, this.elements.upkeepTextYNumberInput, this.handleUpkeepPanelStyleInput);
    this.bindMirroredInputs(this.elements.upkeepTextSizeInput, this.elements.upkeepTextSizeNumberInput, this.handleUpkeepPanelStyleInput);

    readyBackgroundSelect?.addEventListener('change', this.handleReadyBackgroundChange);
    upkeepBackgroundSelect?.addEventListener('change', this.handleUpkeepBackgroundChange);
    layoutExportBtn?.addEventListener('click', this.exportLayout);
    window.addEventListener('resize', this.handleWindowResize);
    this.syncUpkeepPositionInputs();
    this.syncUpkeepBackgroundOptions();
    this.loadBackgroundAsset(DEFAULT_UPKEEP_BACKGROUND_ASSET_PATH).then((img) => { this.upkeepCounterBackgroundImage = img; }).catch(() => {});
    this.loadBackgroundAsset(DEFAULT_READY_BUTTON_BACKGROUND_ASSET_PATH).then((img) => { this.readyButtonBackgroundImage = img; }).catch(() => {});
    this.fetchUpkeepAssets();
    this.renderMatch();
    this.matchmakingPollTimer = window.setInterval(() => this.pollMatchmakingStatus(), this.options.pollIntervalMs);
    this.pollMatchmakingStatus();
  }

  destroy() {
    const { canvas, matchmakingBtn, readyBtn, resetBtn, layoutExportBtn, readyBackgroundSelect, upkeepBackgroundSelect } = this.elements;
    this.stopMatchmakingPolling();
    matchmakingBtn.removeEventListener('click', this.beginMatchmaking);
    readyBtn.removeEventListener('click', this.readyUp);
    canvas?.removeEventListener('pointerup', this.handleCanvasPointerUp);
    resetBtn.removeEventListener('click', this.resetMatch);
    readyBackgroundSelect?.removeEventListener('change', this.handleReadyBackgroundChange);
    upkeepBackgroundSelect?.removeEventListener('change', this.handleUpkeepBackgroundChange);
    layoutExportBtn?.removeEventListener('click', this.exportLayout);
    this.boundControlListeners.forEach((unbind) => unbind());
    this.boundControlListeners = [];
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
    this.teardownReadyButtonDisplay();
  }

  createDisplayTexture(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
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

    const { canvas: panelCanvas, texture: panelTexture } = this.createDisplayTexture(UPKEEP_PANEL_CANVAS_SIZE);
    const panelMaterial = new THREE.MeshBasicMaterial({
      map: panelTexture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(DEFAULT_UPKEEP_PANEL_SIZE.width, DEFAULT_UPKEEP_PANEL_SIZE.height), panelMaterial);
    panelMesh.renderOrder = 1000;
    this.client.camera.add(panelMesh);

    const { canvas: textCanvas, texture: textTexture } = this.createDisplayTexture(UPKEEP_PANEL_CANVAS_SIZE);
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
      total: null,
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
    const depth = Math.max(Math.abs(this.upkeepCounterPosition.z), 0.001);
    const referenceFrustum = getFrustumHalfExtents(UPKEEP_REFERENCE_CAMERA.fov, UPKEEP_REFERENCE_CAMERA.aspect, depth);
    const currentFrustum = getFrustumHalfExtents(this.client.camera.fov, this.client.camera.aspect, depth);
    const scaleFactor = currentFrustum.halfHeight / referenceFrustum.halfHeight;
    const widthScale = this.upkeepCounterPanelSize.width / DEFAULT_UPKEEP_PANEL_SIZE.width;
    const heightScale = this.upkeepCounterPanelSize.height / DEFAULT_UPKEEP_PANEL_SIZE.height;
    const panelWorldWidth = DEFAULT_UPKEEP_PANEL_SIZE.width * scaleFactor * widthScale;
    const panelWorldHeight = DEFAULT_UPKEEP_PANEL_SIZE.height * scaleFactor * heightScale;
    const panelHalfNormalizedX = panelWorldWidth / Math.max(currentFrustum.halfWidth * 2, 0.001);
    const panelHalfNormalizedY = panelWorldHeight / Math.max(currentFrustum.halfHeight * 2, 0.001);
    const targetNormalizedX = THREE.MathUtils.clamp((this.upkeepCounterPosition.x * 2) - 1, -1 + panelHalfNormalizedX, 1 - panelHalfNormalizedX);
    const targetNormalizedY = THREE.MathUtils.clamp(1 - (this.upkeepCounterPosition.y * 2), -1 + panelHalfNormalizedY, 1 - panelHalfNormalizedY);
    const x = targetNormalizedX * currentFrustum.halfWidth;
    const y = targetNormalizedY * currentFrustum.halfHeight;
    panelMesh.position.set(x, y, this.upkeepCounterPosition.z);
    panelMesh.scale.set(scaleFactor * widthScale, scaleFactor * heightScale, 1);
    panelMesh.rotation.set(0, 0, 0);

    const textOffsetX = panelWorldWidth * this.upkeepCounterTextPosition.x;
    const textOffsetY = panelWorldHeight * this.upkeepCounterTextPosition.y;
    textMesh.position.set(x + textOffsetX, y + textOffsetY, this.upkeepCounterPosition.z + 0.001);
    textMesh.scale.set(scaleFactor, scaleFactor, 1);
    textMesh.rotation.set(0, 0, 0);
  }

  drawUpkeepDisplay(upkeepValue, upkeepTotal = 10) {
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

    const upkeepBackground = this.upkeepCounterBackgroundImage || this.backgroundAssetCache.get(DEFAULT_UPKEEP_BACKGROUND_ASSET_PATH) || null;
    if (upkeepBackground) {
      panelCtx.drawImage(upkeepBackground, 0, 0, panelCanvas.width, panelCanvas.height);
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

    textCtx.font = `900 ${Math.round(126 * this.upkeepCounterTextScale)}px Arial, sans-serif`;
    textCtx.textAlign = 'center';
    textCtx.textBaseline = 'middle';
    textCtx.lineJoin = 'round';
    textCtx.lineWidth = 16;
    textCtx.strokeStyle = '#000000';
    textCtx.fillStyle = '#ffffff';

    const text = `Essence: ${upkeepValue}/${upkeepTotal}`;
    const x = textCanvas.width * 0.5;
    const y = textCanvas.height * 0.5;
    textCtx.strokeText(text, x, y);
    textCtx.fillText(text, x, y);

    panelTexture.needsUpdate = true;
    textTexture.needsUpdate = true;
    this.upkeepDisplay.value = upkeepValue;
    this.upkeepDisplay.total = upkeepTotal;
  }

  ensureReadyButtonDisplay() {
    if (!this.client?.camera || !this.client?.scene) return;
    if (this.readyButtonDisplay) return;
    if (this.client.camera.parent !== this.client.scene) {
      this.client.scene.add(this.client.camera);
    }

    const { canvas: panelCanvas, texture: panelTexture } = this.createDisplayTexture(READY_PANEL_CANVAS_SIZE);
    const panelMaterial = new THREE.MeshBasicMaterial({
      map: panelTexture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(DEFAULT_READY_BUTTON_PANEL_SIZE.width, DEFAULT_READY_BUTTON_PANEL_SIZE.height), panelMaterial);
    panelMesh.renderOrder = 1002;
    this.client.camera.add(panelMesh);

    const { canvas: textCanvas, texture: textTexture } = this.createDisplayTexture(READY_PANEL_CANVAS_SIZE);
    const textMaterial = new THREE.MeshBasicMaterial({
      map: textTexture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(DEFAULT_READY_BUTTON_PANEL_SIZE.width, DEFAULT_READY_BUTTON_PANEL_SIZE.height), textMaterial);
    textMesh.renderOrder = 1003;
    this.client.camera.add(textMesh);

    this.readyButtonDisplay = {
      panelCanvas,
      panelTexture,
      panelMaterial,
      panelMesh,
      textCanvas,
      textTexture,
      textMaterial,
      textMesh,
    };
  }

  teardownReadyButtonDisplay() {
    if (!this.readyButtonDisplay) return;
    const { panelMesh, panelMaterial, panelTexture, textMesh, textMaterial, textTexture } = this.readyButtonDisplay;
    panelMesh.parent?.remove(panelMesh);
    panelMesh.geometry.dispose();
    panelMaterial.dispose();
    panelTexture.dispose();
    textMesh.parent?.remove(textMesh);
    textMesh.geometry.dispose();
    textMaterial.dispose();
    textTexture.dispose();
    this.readyButtonDisplay = null;
  }

  positionReadyButtonDisplay() {
    if (!this.readyButtonDisplay || !this.client?.camera) return;
    const { panelMesh, textMesh } = this.readyButtonDisplay;
    const depth = Math.max(Math.abs(this.readyButtonPosition.z), 0.001);
    const referenceFrustum = getFrustumHalfExtents(UPKEEP_REFERENCE_CAMERA.fov, UPKEEP_REFERENCE_CAMERA.aspect, depth);
    const currentFrustum = getFrustumHalfExtents(this.client.camera.fov, this.client.camera.aspect, depth);
    const scaleFactor = currentFrustum.halfHeight / referenceFrustum.halfHeight;
    const widthScale = this.readyButtonPanelSize.width / DEFAULT_READY_BUTTON_PANEL_SIZE.width;
    const heightScale = this.readyButtonPanelSize.height / DEFAULT_READY_BUTTON_PANEL_SIZE.height;
    const panelWorldWidth = DEFAULT_READY_BUTTON_PANEL_SIZE.width * scaleFactor * widthScale;
    const panelWorldHeight = DEFAULT_READY_BUTTON_PANEL_SIZE.height * scaleFactor * heightScale;
    const panelHalfNormalizedX = panelWorldWidth / Math.max(currentFrustum.halfWidth * 2, 0.001);
    const panelHalfNormalizedY = panelWorldHeight / Math.max(currentFrustum.halfHeight * 2, 0.001);
    const targetNormalizedX = THREE.MathUtils.clamp((this.readyButtonPosition.x * 2) - 1, -1 + panelHalfNormalizedX, 1 - panelHalfNormalizedX);
    const targetNormalizedY = THREE.MathUtils.clamp(1 - (this.readyButtonPosition.y * 2), -1 + panelHalfNormalizedY, 1 - panelHalfNormalizedY);
    const x = targetNormalizedX * currentFrustum.halfWidth;
    const y = targetNormalizedY * currentFrustum.halfHeight;
    panelMesh.position.set(x, y, this.readyButtonPosition.z);
    panelMesh.scale.set(scaleFactor * widthScale, scaleFactor * heightScale, 1);
    panelMesh.rotation.set(0, 0, 0);

    const textOffsetX = panelWorldWidth * this.readyButtonTextPosition.x;
    const textOffsetY = panelWorldHeight * this.readyButtonTextPosition.y;
    textMesh.position.set(x + textOffsetX, y + textOffsetY, this.readyButtonPosition.z + 0.001);
    textMesh.scale.set(scaleFactor, scaleFactor, 1);
    textMesh.rotation.set(0, 0, 0);
  }

  drawReadyButtonDisplay() {
    if (!this.readyButtonDisplay) return;
    const {
      panelCanvas,
      panelTexture,
      textCanvas,
      textTexture,
    } = this.readyButtonDisplay;
    const panelCtx = panelCanvas.getContext('2d');
    const textCtx = textCanvas.getContext('2d');
    if (!panelCtx || !textCtx) return;

    panelCtx.clearRect(0, 0, panelCanvas.width, panelCanvas.height);
    textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);

    if (this.readyButtonBackgroundImage) {
      panelCtx.drawImage(this.readyButtonBackgroundImage, 0, 0, panelCanvas.width, panelCanvas.height);
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

    const activeSpell = this.getActiveSpellResolution();
    const spellLocked = Boolean(activeSpell && activeSpell.completedAt == null);
    const canInteract = Boolean(this.match && this.match.phase === 1 && !this.match.youAreReady && !spellLocked);
    textCtx.font = `900 ${Math.round(126 * this.readyButtonTextScale)}px Arial, sans-serif`;
    textCtx.textAlign = 'center';
    textCtx.textBaseline = 'middle';
    textCtx.lineJoin = 'round';
    textCtx.lineWidth = 16;
    textCtx.strokeStyle = '#000000';
    textCtx.fillStyle = canInteract ? '#ffffff' : '#aeb6cc';

    const x = textCanvas.width * 0.5;
    const y = textCanvas.height * 0.5;
    textCtx.strokeText(READY_BUTTON_LABEL, x, y);
    textCtx.fillText(READY_BUTTON_LABEL, x, y);

    if (!canInteract) {
      panelCtx.fillStyle = 'rgba(8, 11, 18, 0.42)';
      panelCtx.fillRect(0, 0, panelCanvas.width, panelCanvas.height);
    }

    panelTexture.needsUpdate = true;
    textTexture.needsUpdate = true;
  }

  syncReadyButtonDisplay() {
    if (!this.client || !this.match) return;
    this.ensureReadyButtonDisplay();
    this.positionReadyButtonDisplay();
    this.drawReadyButtonDisplay();
  }

  handleCanvasPointerUp(event) {
    if (!this.readyButtonDisplay || !this.client?.camera || !this.elements.canvas) return;
    const rect = this.elements.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.client.camera);
    const hits = raycaster.intersectObject(this.readyButtonDisplay.panelMesh, false);
    if (!hits.length) return;
    this.readyUp();
  }

  syncUpkeepDisplay() {
    if (!this.client || !this.match) return;
    const upkeepValue = Number.isInteger(this.match.upkeep) ? this.match.upkeep : 1;
    const upkeepTotal = Number.isInteger(this.match.upkeepTotal) ? this.match.upkeepTotal : 10;
    this.ensureUpkeepDisplay();
    this.positionUpkeepDisplay();
    if (this.upkeepDisplay?.value !== upkeepValue || this.upkeepDisplay?.total !== upkeepTotal) {
      this.drawUpkeepDisplay(upkeepValue, upkeepTotal);
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
        tauntTurnsRemaining: Number.isInteger(card.tauntTurnsRemaining) ? card.tauntTurnsRemaining : 0,
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
        tauntTurnsRemaining: Number.isInteger(card.tauntTurnsRemaining) ? card.tauntTurnsRemaining : 0,
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

  syncCardBuffStateFromMatch(currentMatch) {
    if (!this.client || !currentMatch?.players) return;

    const buffStateByCardId = new Map();
    [PLAYER_SIDE, OPPONENT_SIDE].forEach((side) => {
      const boardCards = Array.isArray(currentMatch.players?.[side]?.board)
        ? currentMatch.players[side].board
        : [];
      boardCards.forEach((card) => {
        if (!card?.id) return;
        buffStateByCardId.set(card.id, {
          tauntTurnsRemaining: Number.isInteger(card.tauntTurnsRemaining) ? card.tauntTurnsRemaining : 0,
        });
      });
    });

    this.client.cards.forEach((sceneCard) => {
      if (!sceneCard?.userData) return;
      const state = buffStateByCardId.get(sceneCard.userData.cardId);
      sceneCard.userData.tauntTurnsRemaining = state?.tauntTurnsRemaining ?? 0;
      sceneCard.userData.activeBuffIds = [];
      this.client.updateCardBuffBadges(sceneCard);
    });
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
    if (this.readyButtonDisplay) this.drawReadyButtonDisplay();
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
      this.teardownReadyButtonDisplay();
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
    this.syncReadyButtonDisplay();

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
          this.syncCardBuffStateFromMatch(this.match);
          this.setReadyLockState();
          this.updateSummaryPanels();
          this.triggerRemoteSpellPlayback();
        }
      } else {
        this.syncCardBuffStateFromMatch(this.match);
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
