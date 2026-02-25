import { CardGameClient, CARD_ZONE_TYPES, DEFAULT_ZONE_FRAMEWORK, createDeckToHandDealHook, loadPreviewTuning } from '/public/card-game/index.js';
import { CardRollerOverlay } from './CardRollerOverlay.js';
import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const PLAYER_SIDE = 'player';
const OPPONENT_SIDE = 'opponent';
const BOARD_SLOTS_PER_SIDE = 3;
const UPKEEP_TUNING_STORAGE_KEY = 'storycard.phaseManager.upkeepHudTuning.v1';
const DEFAULT_UPKEEP_HUD_TUNING = Object.freeze({
  planePosition: { x: 1.2, y: 0.72, z: -2.2 },
  numberOffset: { x: 0, y: 0 },
  backgroundAsset: 'none',
});
const UPKEEP_BACKGROUND_ASSET_OPTIONS = Object.freeze([
  { label: 'None', value: 'none' },
  { label: 'CardFront', value: '/public/assets/CardFront.png' },
  { label: 'CardFront2', value: '/public/assets/CardFront2.png' },
  { label: 'CardFront2 hole', value: '/public/assets/CardFront2hole.png' },
  { label: 'CardFront Spell', value: '/public/assets/CardFrontSpell.png' },
  { label: 'Card Back', value: '/public/assets/CardBack.png' },
]);

function normalizeHudNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeUpkeepHudTuning(tuning = {}) {
  return {
    planePosition: {
      x: normalizeHudNumber(tuning?.planePosition?.x, DEFAULT_UPKEEP_HUD_TUNING.planePosition.x),
      y: normalizeHudNumber(tuning?.planePosition?.y, DEFAULT_UPKEEP_HUD_TUNING.planePosition.y),
      z: normalizeHudNumber(tuning?.planePosition?.z, DEFAULT_UPKEEP_HUD_TUNING.planePosition.z),
    },
    numberOffset: {
      x: normalizeHudNumber(tuning?.numberOffset?.x, DEFAULT_UPKEEP_HUD_TUNING.numberOffset.x),
      y: normalizeHudNumber(tuning?.numberOffset?.y, DEFAULT_UPKEEP_HUD_TUNING.numberOffset.y),
    },
    backgroundAsset: typeof tuning?.backgroundAsset === 'string' ? tuning.backgroundAsset : DEFAULT_UPKEEP_HUD_TUNING.backgroundAsset,
  };
}

function loadUpkeepHudTuning() {
  try {
    const raw = window.localStorage.getItem(UPKEEP_TUNING_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UPKEEP_HUD_TUNING };
    return sanitizeUpkeepHudTuning(JSON.parse(raw));
  } catch (error) {
    return { ...DEFAULT_UPKEEP_HUD_TUNING };
  }
}

function saveUpkeepHudTuning(tuning) {
  const next = sanitizeUpkeepHudTuning(tuning);
  try {
    window.localStorage.setItem(UPKEEP_TUNING_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    // no-op
  }
  return next;
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
    this.playedRemoteSpellResolutionIds = new Set();
    this.previewTuning = loadPreviewTuning();
    this.upkeepHudTuning = loadUpkeepHudTuning();
    this.playerId = createTabPlayerId();
    this.upkeepHud = {
      group: null,
      backgroundPlane: null,
      numberSprite: null,
      numberCanvas: null,
      numberTexture: null,
      currentAsset: null,
    };
    this.upkeepAssetTextureCache = new Map();
    this.upkeepTextureLoader = new THREE.TextureLoader();

    this.beginMatchmaking = this.beginMatchmaking.bind(this);
    this.readyUp = this.readyUp.bind(this);
    this.resetMatch = this.resetMatch.bind(this);
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

  start() {
    const { matchmakingBtn, readyBtn, resetBtn } = this.elements;
    matchmakingBtn.addEventListener('click', this.beginMatchmaking);
    readyBtn.addEventListener('click', this.readyUp);
    resetBtn.addEventListener('click', this.resetMatch);
    this.bindUpkeepHudControls();
    this.renderMatch();
    this.matchmakingPollTimer = window.setInterval(() => this.pollMatchmakingStatus(), this.options.pollIntervalMs);
    this.pollMatchmakingStatus();
  }

  destroy() {
    const { matchmakingBtn, readyBtn, resetBtn } = this.elements;
    this.stopMatchmakingPolling();
    matchmakingBtn.removeEventListener('click', this.beginMatchmaking);
    readyBtn.removeEventListener('click', this.readyUp);
    resetBtn.removeEventListener('click', this.resetMatch);
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.cardRollerOverlay) {
      this.cardRollerOverlay.destroy();
      this.cardRollerOverlay = null;
    }
    this.destroyUpkeepHud();
  }

  stopMatchmakingPolling() {
    if (this.matchmakingPollTimer) {
      window.clearInterval(this.matchmakingPollTimer);
      this.matchmakingPollTimer = 0;
    }
  }

  destroyUpkeepHud() {
    if (this.upkeepHud.group?.parent) {
      this.upkeepHud.group.parent.remove(this.upkeepHud.group);
    }
    this.upkeepHud.backgroundPlane?.geometry?.dispose?.();
    this.upkeepHud.backgroundPlane?.material?.dispose?.();
    this.upkeepHud.numberTexture?.dispose?.();
    this.upkeepHud.numberSprite?.material?.dispose?.();
    this.upkeepHud = {
      group: null,
      backgroundPlane: null,
      numberSprite: null,
      numberCanvas: null,
      numberTexture: null,
      currentAsset: null,
    };
  }

  initializeUpkeepHud() {
    if (!this.client?.camera || this.upkeepHud.group) return;

    const group = new THREE.Group();
    const backgroundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.58),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthTest: false }),
    );
    backgroundPlane.renderOrder = 1000;
    group.add(backgroundPlane);

    const numberCanvas = document.createElement('canvas');
    numberCanvas.width = 256;
    numberCanvas.height = 256;
    const numberTexture = new THREE.CanvasTexture(numberCanvas);

    const numberSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture, transparent: true, depthTest: false }));
    numberSprite.renderOrder = 1001;
    numberSprite.scale.set(0.4, 0.4, 1);
    group.add(numberSprite);

    this.upkeepHud = {
      group,
      backgroundPlane,
      numberSprite,
      numberCanvas,
      numberTexture,
      currentAsset: null,
    };

    this.client.camera.add(group);
    this.applyUpkeepHudTuning();
    this.applyUpkeepBackgroundAsset(this.upkeepHudTuning.backgroundAsset);
    this.updateUpkeepNumberSprite();
  }

  updateUpkeepNumberSprite() {
    if (!this.upkeepHud.numberCanvas || !this.upkeepHud.numberTexture) return;
    const upkeepValue = Math.max(1, Math.min(10, Number(this.match?.upkeep) || 1));
    const ctx = this.upkeepHud.numberCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.upkeepHud.numberCanvas.width, this.upkeepHud.numberCanvas.height);
    ctx.font = 'bold 180px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 22;
    ctx.strokeText(String(upkeepValue), 128, 130);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(upkeepValue), 128, 130);
    this.upkeepHud.numberTexture.needsUpdate = true;
  }

  applyUpkeepBackgroundAsset(assetPath) {
    if (!this.upkeepHud.backgroundPlane || this.upkeepHud.currentAsset === assetPath) return;
    this.upkeepHud.currentAsset = assetPath;
    const material = this.upkeepHud.backgroundPlane.material;

    if (!assetPath || assetPath === 'none') {
      material.map = null;
      material.opacity = 0;
      material.needsUpdate = true;
      return;
    }

    material.opacity = 1;
    const cachedTexture = this.upkeepAssetTextureCache.get(assetPath);
    if (cachedTexture) {
      material.map = cachedTexture;
      material.needsUpdate = true;
      return;
    }

    this.upkeepTextureLoader.load(assetPath, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      this.upkeepAssetTextureCache.set(assetPath, texture);
      if (this.upkeepHud.currentAsset !== assetPath || !this.upkeepHud.backgroundPlane) return;
      this.upkeepHud.backgroundPlane.material.map = texture;
      this.upkeepHud.backgroundPlane.material.needsUpdate = true;
    });
  }

  applyUpkeepHudTuning() {
    this.upkeepHudTuning = sanitizeUpkeepHudTuning(this.upkeepHudTuning);
    const tuning = this.upkeepHudTuning;
    if (this.upkeepHud.group) {
      this.upkeepHud.group.position.set(tuning.planePosition.x, tuning.planePosition.y, tuning.planePosition.z);
    }
    if (this.upkeepHud.numberSprite) {
      this.upkeepHud.numberSprite.position.set(tuning.numberOffset.x, tuning.numberOffset.y, 0.01);
    }
    this.applyUpkeepBackgroundAsset(tuning.backgroundAsset);
  }

  bindUpkeepHudControls() {
    const {
      upkeepPlaneXInput,
      upkeepPlaneYInput,
      upkeepPlaneZInput,
      upkeepNumberXInput,
      upkeepNumberYInput,
      upkeepBackgroundSelect,
      upkeepExportBtn,
      upkeepExportOutput,
    } = this.elements;
    if (!upkeepPlaneXInput) return;

    upkeepBackgroundSelect.innerHTML = '';
    UPKEEP_BACKGROUND_ASSET_OPTIONS.forEach((assetOption) => {
      const option = document.createElement('option');
      option.value = assetOption.value;
      option.textContent = assetOption.label;
      upkeepBackgroundSelect.append(option);
    });

    const persistAndApply = () => {
      this.upkeepHudTuning = saveUpkeepHudTuning(this.upkeepHudTuning);
      this.applyUpkeepHudTuning();
      if (upkeepExportOutput) upkeepExportOutput.value = JSON.stringify(this.upkeepHudTuning, null, 2);
    };

    upkeepPlaneXInput.value = String(this.upkeepHudTuning.planePosition.x);
    upkeepPlaneYInput.value = String(this.upkeepHudTuning.planePosition.y);
    upkeepPlaneZInput.value = String(this.upkeepHudTuning.planePosition.z);
    upkeepNumberXInput.value = String(this.upkeepHudTuning.numberOffset.x);
    upkeepNumberYInput.value = String(this.upkeepHudTuning.numberOffset.y);
    upkeepBackgroundSelect.value = this.upkeepHudTuning.backgroundAsset;

    upkeepPlaneXInput.addEventListener('input', () => {
      this.upkeepHudTuning.planePosition.x = Number(upkeepPlaneXInput.value);
      persistAndApply();
    });
    upkeepPlaneYInput.addEventListener('input', () => {
      this.upkeepHudTuning.planePosition.y = Number(upkeepPlaneYInput.value);
      persistAndApply();
    });
    upkeepPlaneZInput.addEventListener('input', () => {
      this.upkeepHudTuning.planePosition.z = Number(upkeepPlaneZInput.value);
      persistAndApply();
    });
    upkeepNumberXInput.addEventListener('input', () => {
      this.upkeepHudTuning.numberOffset.x = Number(upkeepNumberXInput.value);
      persistAndApply();
    });
    upkeepNumberYInput.addEventListener('input', () => {
      this.upkeepHudTuning.numberOffset.y = Number(upkeepNumberYInput.value);
      persistAndApply();
    });
    upkeepBackgroundSelect.addEventListener('change', () => {
      this.upkeepHudTuning.backgroundAsset = upkeepBackgroundSelect.value;
      persistAndApply();
    });
    upkeepExportBtn?.addEventListener('click', () => {
      if (upkeepExportOutput) upkeepExportOutput.value = JSON.stringify(this.upkeepHudTuning, null, 2);
    });

    if (upkeepExportOutput) upkeepExportOutput.value = JSON.stringify(this.upkeepHudTuning, null, 2);
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
      this.initializeUpkeepHud();
    } else {
      this.client.template = template;
      this.client.resetDemo();
      this.client.setPreviewTuning(this.previewTuning);
      this.initializeUpkeepHud();
    }

    this.updateUpkeepNumberSprite();

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
      this.destroyUpkeepHud();
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
      this.destroyUpkeepHud();
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
