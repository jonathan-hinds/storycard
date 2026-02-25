import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from '../render/CardMeshFactory.js';
import { CARD_LABEL_CANVAS_SIZE, createCardLabelTexture } from '../render/cardLabelTexture.js';
import { getDefaultCardBackgroundImagePath, getDefaultCardLabelLayout, resolveCardKind } from '../render/cardStyleConfig.js';
import { CardPicker } from '../render/CardPicker.js';
import { CardGameHttpClient } from '../net/httpClient.js';
import { SINGLE_CARD_TEMPLATE } from '../templates/singleCardTemplate.js';
import { CARD_ZONE_TYPES, isKnownZone, validateZoneTemplate } from './zoneFramework.js';
import { DEFAULT_PREVIEW_TUNING, sanitizePreviewTuning } from './previewTuning.js';
import { PREVIEW_TRANSITION_IN_MS, PREVIEW_BASE_POSITION, beginPreviewTransition, beginPreviewReturnTransition, getPreviewPose } from './previewMotion.js';
import { DieRollerClient } from '/public/die-roller/index.js';

const CAMERA_BASE_FOV = 45;
const CAMERA_BASE_Y = 8.2;
const CAMERA_BASE_Z = 4.8;
const CAMERA_LOOK_AT_Y = 0;
const CAMERA_LOOK_AT_Z = 0.4;
const CAMERA_PORTRAIT_FOV_BOOST = 20;
const CAMERA_PORTRAIT_Y_BOOST = 3.2;
const CAMERA_PORTRAIT_Z_BOOST = 1.8;

const HAND_BASE_Z = 3.2;
const HAND_CAMERA_CLOSENESS = 0.45;
const HAND_PORTRAIT_CLOSENESS = 0.35;

const DRAG_START_DISTANCE_PX = 10;
const CARD_FACE_ROTATION_X = -Math.PI / 2;
const OPPONENT_BOARD_ROTATION_Z = Math.PI;
const HAND_CARD_BASE_Y = 0.1;
const HAND_CARD_ARC_LIFT = 0.06;
const HAND_CARD_FAN_ROTATION_Z = 0.08;
const CARD_ANIMATION_MAGIC_SWAY_SPEED = 7.2;
const PLACED_CARD_SWIRL_AMPLITUDE = 0.024;
const PLACED_CARD_VERTICAL_SWAY_AMPLITUDE = 0.028;
const PLACED_CARD_ROTATIONAL_FLARE_AMPLITUDE = 0.032;
const ATTACK_TARGET_SCALE = 1.12;
const CARD_OUTLINE_BASE_SCALE = 1.01;
const CARD_OUTLINE_HIGHLIGHT_SCALE = 1.03;
const CARD_OUTLINE_BASE_COLOR = 0x000000;
const CARD_OUTLINE_HIGHLIGHT_COLOR = 0xffffff;
const SPELL_CENTER_POSITION = Object.freeze(new THREE.Vector3(1.05, 0.32, 0.2));
const SPELL_ATTACK_DELAY_AFTER_IMPACT_MS = 2000;
const SPELL_DEATH_SETTLE_WAIT_MS = 700;
const COMBAT_NUMBER_DURATION_MS = 620;
const COMBAT_NUMBER_DRIFT_DISTANCE = 86;
const COMBAT_NUMBER_VARIANTS = Object.freeze({
  damage: 'damage',
  beneficial: 'beneficial',
});
const TARGET_TYPES = Object.freeze({ self: 'self', friendly: 'friendly', enemy: 'enemy', none: 'none' });
const CARD_BACK_TEXTURE_URL = '/public/assets/CardBack.png';

export class CardGameClient {
  constructor({ canvas, statusElement, resetButton, template = SINGLE_CARD_TEMPLATE, options = {} }) {
    if (!canvas) throw new Error('canvas is required');
    this.canvas = canvas;
    this.canvasContainer = canvas.parentElement;
    this.statusEl = statusElement;
    this.resetBtn = resetButton;
    this.template = template;
    this.zoneFramework = this.template.zoneFramework;
    validateZoneTemplate(this.template, this.zoneFramework);
    this.options = options;
    this.previewTuning = sanitizePreviewTuning(options.previewTuning || DEFAULT_PREVIEW_TUNING);
    this.onCardStateCommitted = options.onCardStateCommitted;
    this.onSpellResolutionRequested = options.onSpellResolutionRequested;
    this.onSpellRollResolved = options.onSpellRollResolved;
    this.onSpellResolutionFinished = options.onSpellResolutionFinished;
    this.getSpellResolutionSnapshot = options.getSpellResolutionSnapshot;
    this.cardAnimationHooks = Array.isArray(options.cardAnimationHooks) ? options.cardAnimationHooks : [];
    this.net = new CardGameHttpClient(options.net || {});

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.cardBackTexture = new THREE.TextureLoader().load(CARD_BACK_TEXTURE_URL);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 8.2, 4.8);
    this.camera.lookAt(0, 0, 0.4);

    this.cards = [];
    this.discardedCardSnapshotsById = new Map();
    this.boardSlots = [];
    this.deckSlots = [];
    this.cardAnimations = [];
    this.combatAnimations = [];
    this.combatShakeEffects = [];
    this.deathAnimations = [];
    this.damagePopups = [];
    this.pointerNdc = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.planePoint = new THREE.Vector3();

    this.state = {
      previewViewportVariant: 'desktop',
      activePointerId: null,
      pendingCard: null,
      pendingCardCanDrag: false,
      pendingCardDidPickup: false,
      activeCard: null,
      mode: 'idle',
      holdTimer: 0,
      lastPointer: { x: 0, y: 0 },
      pressPointer: { x: 0, y: 0 },
      previewStartedAt: 0,
      dragOrigin: null,
      dropSlotIndex: null,
      dropTargetSlotIndex: null,
      pendingAbilitySelection: null,
      selectedAbilityByCardId: new Map(),
      activePose: {
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(CARD_FACE_ROTATION_X, 0, 0),
      },
      previewOriginPose: {
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(CARD_FACE_ROTATION_X, 0, 0),
      },
      previewTransition: {
        isActive: false,
        direction: 'toPreview',
        startedAt: 0,
        durationMs: PREVIEW_TRANSITION_IN_MS,
      },
      portraitIntensity: 0,
      spellResolutionInProgress: false,
      activeSpellRoller: null,
      spellRollerLayer: null,
      activeSpellResolutionId: null,
      remoteSpellResolutionPromise: null,
    };

    this.#buildBaseScene();
    this.#setupDamagePopupLayer();
    this.setPreviewTuning(this.previewTuning);
    this.picker = new CardPicker({ camera: this.camera, domElement: canvas, cards: this.cards });

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.updateSize = this.updateSize.bind(this);
    this.animate = this.animate.bind(this);
    this.resetDemo = this.resetDemo.bind(this);

    this.canvasContainer.addEventListener('pointerdown', this.handlePointerDown);
    this.canvasContainer.addEventListener('pointermove', this.handlePointerMove);
    this.canvasContainer.addEventListener('pointerup', this.handlePointerUp);
    this.canvasContainer.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('resize', this.updateSize);
    this.resetBtn?.addEventListener('click', this.resetDemo);

    this.updateSize();
    this.resetDemo();
    this.animationFrame = requestAnimationFrame(this.animate);
    this.loadCardState();
  }

  #buildBaseScene() {
    this.hemiLight = new THREE.HemisphereLight(0xeaf2ff, 0x202938, 0.9);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    this.keyLight.position.set(4, 8, 6);
    this.keyLight.castShadow = true;
    this.scene.add(this.keyLight);

    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.95, metalness: 0.03 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.72;
    table.receiveShadow = true;
    this.scene.add(table);

    const boardArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.3, 5.8),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.85, metalness: 0.06, transparent: true, opacity: 0.45 }),
    );
    boardArea.position.set(0, -0.71, 0.15);
    boardArea.rotation.x = -Math.PI / 2;
    this.scene.add(boardArea);

    const playerTerritoryArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.3, 2.9),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.86, metalness: 0.08, transparent: true, opacity: 0.38 }),
    );
    playerTerritoryArea.position.set(0, -0.708, 1.6);
    playerTerritoryArea.rotation.x = -Math.PI / 2;
    this.scene.add(playerTerritoryArea);

    const opponentTerritoryArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.3, 2.9),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.86, metalness: 0.08, transparent: true, opacity: 0.26 }),
    );
    opponentTerritoryArea.position.set(0, -0.708, -1.3);
    opponentTerritoryArea.rotation.x = -Math.PI / 2;
    this.scene.add(opponentTerritoryArea);

    this.handArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 2),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.9, metalness: 0.04, transparent: true, opacity: 0.55 }),
    );
    this.handArea.position.set(0, -0.71, HAND_BASE_Z);
    this.handArea.rotation.x = -Math.PI / 2;
    this.scene.add(this.handArea);

    const playerBoardSlotMaterial = new THREE.MeshStandardMaterial({ color: 0x7ca0e7, transparent: true, opacity: 0.2, roughness: 0.85, metalness: 0.08 });
    const opponentBoardSlotMaterial = new THREE.MeshStandardMaterial({ color: 0xd08db1, transparent: true, opacity: 0.17, roughness: 0.9, metalness: 0.08 });

    this.template.boardSlotLayout.forEach((slot, index) => {
      const slotMaterial = slot.side === this.template.playerSide ? playerBoardSlotMaterial.clone() : opponentBoardSlotMaterial.clone();
      const slotMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 2.65), slotMaterial);
      slotMesh.rotation.x = -Math.PI / 2;
      slotMesh.position.set(slot.x, -0.695, slot.z);
      this.scene.add(slotMesh);
      this.boardSlots.push({ index, x: slot.x, z: slot.z, side: slot.side, card: null, mesh: slotMesh });
    });

    this.template.deckSlotLayout.forEach((slot) => {
      const slotMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 2.65), new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.26, roughness: 0.86, metalness: 0.07 }));
      slotMesh.rotation.x = -Math.PI / 2;
      slotMesh.position.set(slot.x, -0.694, slot.z);
      this.scene.add(slotMesh);

      const deck = CardMeshFactory.createCard({
        id: `${slot.side}-deck`, width: 1.8, height: 2.5, thickness: 0.42, cornerRadius: 0.15,
        color: 0x000000,
        faceTexture: this.cardBackTexture,
      });
      deck.position.set(slot.x, 0.17, slot.z);
      deck.rotation.set(-Math.PI / 2, 0, slot.side === this.template.playerSide ? 0 : OPPONENT_BOARD_ROTATION_Z);
      deck.userData.zone = CARD_ZONE_TYPES.DECK;
      deck.userData.owner = slot.side;
      deck.userData.locked = true;
      this.scene.add(deck);

      this.deckSlots.push({ ...slot, mesh: slotMesh, deck });
    });
  }

  setStatus(message) {
    if (this.statusEl) this.statusEl.textContent = message;
  }

  updateSize() {
    const width = this.canvas.parentElement.clientWidth;
    const compactViewport = window.innerWidth <= 900;
    this.state.previewViewportVariant = compactViewport ? 'mobile' : 'desktop';
    const minHeight = compactViewport ? 320 : 460;
    const height = Math.max(minHeight, window.innerHeight - 140);
    const aspect = width / height;
    const portraitIntensity = THREE.MathUtils.clamp((1 - aspect) / 0.45, 0, 1);
    this.state.portraitIntensity = portraitIntensity;

    this.camera.fov = CAMERA_BASE_FOV + portraitIntensity * CAMERA_PORTRAIT_FOV_BOOST;
    this.camera.position.set(0, CAMERA_BASE_Y + portraitIntensity * CAMERA_PORTRAIT_Y_BOOST, CAMERA_BASE_Z + portraitIntensity * CAMERA_PORTRAIT_Z_BOOST);
    this.camera.lookAt(0, CAMERA_LOOK_AT_Y, CAMERA_LOOK_AT_Z);

    this.renderer.setSize(width, height, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.handArea.position.z = HAND_BASE_Z + HAND_CAMERA_CLOSENESS + portraitIntensity * HAND_PORTRAIT_CLOSENESS;
    this.relayoutBoardAndHand();
  }

  clearHighlights() {
    for (const slot of this.boardSlots) slot.mesh.material.opacity = slot.side === this.template.playerSide ? 0.2 : 0.17;
    for (const card of this.cards) {
      if (card.userData?.mesh?.material?.color) card.userData.mesh.material.color.setHex(0x000000);
      const outline = card.userData?.outline;
      if (outline?.material?.color) {
        outline.material.color.setHex(CARD_OUTLINE_BASE_COLOR);
        outline.scale.setScalar(CARD_OUTLINE_BASE_SCALE);
      }
      card.scale.setScalar(card.userData.isAttackHover ? ATTACK_TARGET_SCALE : 1);
    }
    this.clearAttackTargetHover();
  }

  applySelectionGlow(card) {
    if (!card?.userData?.mesh?.material) return;
    card.userData.mesh.material.color.setHex(0x000000);
    const outline = card.userData?.outline;
    if (outline?.material?.color) {
      outline.material.color.setHex(CARD_OUTLINE_HIGHLIGHT_COLOR);
      outline.scale.setScalar(CARD_OUTLINE_HIGHLIGHT_SCALE);
    }
    card.scale.setScalar(1.04);
  }

  clearAttackTargetHover() {
    for (const card of this.cards) {
      if (!card.userData.isAttackHover) continue;
      card.scale.setScalar(1);
      card.userData.isAttackHover = false;
    }
  }

  #setupDamagePopupLayer() {
    if (!this.canvasContainer) return;
    const computedStyle = window.getComputedStyle(this.canvasContainer);
    if (!computedStyle || computedStyle.position === 'static') {
      this.canvasContainer.style.position = 'relative';
    }

    const layer = document.createElement('div');
    layer.className = 'damage-number-overlay-layer';
    this.canvasContainer.append(layer);
    this.damagePopupLayer = layer;
  }

  getScreenPositionForWorldPoint(worldPoint) {
    if (!worldPoint) return null;
    const projected = worldPoint.clone().project(this.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((projected.x + 1) / 2) * rect.width;
    const y = ((-projected.y + 1) / 2) * rect.height;
    return { x, y };
  }

  spawnCombatNumberPopup({ amount, worldPoint, time = performance.now(), prefix = '', variant = COMBAT_NUMBER_VARIANTS.damage }) {
    if (!this.damagePopupLayer || !Number.isFinite(amount) || amount <= 0 || !worldPoint) return;
    const start = this.getScreenPositionForWorldPoint(worldPoint);
    if (!start) return;

    const driftAngle = Math.random() * Math.PI * 2;
    const driftDistance = COMBAT_NUMBER_DRIFT_DISTANCE * (0.65 + Math.random() * 0.45);
    const driftX = Math.cos(driftAngle) * driftDistance;
    const driftY = Math.sin(driftAngle) * driftDistance - 36;

    const node = document.createElement('div');
    node.className = `damage-number-popup damage-number-popup--${variant}`;
    node.textContent = `${prefix}${Math.round(amount)}`;
    node.style.left = `${start.x}px`;
    node.style.top = `${start.y}px`;
    this.damagePopupLayer.append(node);

    this.damagePopups.push({
      node,
      startAtMs: time,
      durationMs: COMBAT_NUMBER_DURATION_MS,
      startX: start.x,
      startY: start.y,
      driftX,
      driftY,
    });
  }

  spawnDamagePopup({ amount, worldPoint, time = performance.now() }) {
    this.spawnCombatNumberPopup({ amount, worldPoint, time, prefix: '-', variant: COMBAT_NUMBER_VARIANTS.damage });
  }

  spawnBeneficialPopup({ amount, worldPoint, time = performance.now() }) {
    this.spawnCombatNumberPopup({ amount, worldPoint, time, prefix: '+', variant: COMBAT_NUMBER_VARIANTS.beneficial });
  }

  applyDamagePopups(time) {
    if (!this.damagePopups.length) return;
    const remaining = [];
    for (const popup of this.damagePopups) {
      const elapsed = time - popup.startAtMs;
      const progress = THREE.MathUtils.clamp(elapsed / popup.durationMs, 0, 1);
      const eased = THREE.MathUtils.smootherstep(progress, 0, 1);
      const x = popup.startX + popup.driftX * eased;
      const y = popup.startY + popup.driftY * eased;
      popup.node.style.left = `${x}px`;
      popup.node.style.top = `${y}px`;
      popup.node.style.opacity = `${1 - eased}`;
      popup.node.style.transform = `translate(-50%, -50%) scale(${1 + (1 - eased) * 0.22})`;
      if (progress >= 1) {
        popup.node.remove();
      } else {
        remaining.push(popup);
      }
    }
    this.damagePopups = remaining;
  }

  cardWorldPositionForHand(indexInHand, totalInHand) {
    const spread = Math.max(totalInHand - 1, 1);
    const normalizedIndex = spread === 0 ? 0 : indexInHand / spread - 0.5;
    const x = (indexInHand - spread / 2) * 2.0;
    const y = HAND_CARD_BASE_Y + (0.5 - Math.abs(normalizedIndex)) * HAND_CARD_ARC_LIFT;
    const handZ = HAND_BASE_Z + HAND_CAMERA_CLOSENESS + this.state.portraitIntensity * HAND_PORTRAIT_CLOSENESS;
    const z = handZ + Math.abs(normalizedIndex) * 0.12;
    return new THREE.Vector3(x, y, z);
  }

  getBoardRotationForSlot(slot) {
    return {
      y: 0,
      z: slot?.side === this.template.playerSide ? 0 : OPPONENT_BOARD_ROTATION_Z,
    };
  }

  getBoardRotationForCard(card) {
    if (!card || card.userData.zone !== CARD_ZONE_TYPES.BOARD || !Number.isInteger(card.userData.slotIndex)) {
      return { y: 0, z: 0 };
    }
    return this.getBoardRotationForSlot(this.boardSlots[card.userData.slotIndex]);
  }

  relayoutBoardAndHand() {
    this.boardSlots.forEach((slot) => {
      if (!slot.card) return;
      const card = slot.card;
      if (card.userData.isAnimating) return;
      if (card === this.state.activeCard && (this.state.mode === 'drag' || this.state.mode === 'preview')) return;
      card.userData.zone = CARD_ZONE_TYPES.BOARD;
      card.userData.slotIndex = slot.index;
      card.position.set(slot.x, 0, slot.z);
      const { y, z } = this.getBoardRotationForSlot(slot);
      card.rotation.set(CARD_FACE_ROTATION_X, y, z);
    });

    const handCards = this.cards.filter((card) => card.userData.zone === CARD_ZONE_TYPES.HAND);
    handCards.forEach((card, index) => {
      if (card.userData.isAnimating) return;
      if (card === this.state.activeCard && (this.state.mode === 'drag' || this.state.mode === 'preview')) return;
      const pos = this.cardWorldPositionForHand(index, handCards.length);
      card.position.copy(pos);
      const spread = Math.max(handCards.length - 1, 1);
      const normalizedIndex = spread === 0 ? 0 : index / spread - 0.5;
      card.rotation.set(CARD_FACE_ROTATION_X, 0, -normalizedIndex * HAND_CARD_FAN_ROTATION_Z);
      card.userData.slotIndex = null;
    });
  }

  setActiveCardPose(position, rotationX, rotationY = 0, rotationZ = 0) {
    this.state.activePose.position.copy(position);
    this.state.activePose.rotation.set(rotationX, rotationY, rotationZ);
  }

  getResolvedPreviewOffsets() {
    const variant = this.state.previewViewportVariant === 'mobile' ? 'previewOffsetMobile' : 'previewOffsetDesktop';
    const offsets = this.previewTuning[variant] || this.previewTuning.previewOffsetDesktop;
    return {
      x: Number.isFinite(offsets?.x) ? offsets.x : this.previewTuning.previewOffsetX,
      y: Number.isFinite(offsets?.y) ? offsets.y : this.previewTuning.previewOffsetY,
      z: Number.isFinite(offsets?.z) ? offsets.z : this.previewTuning.cameraDistanceOffset,
    };
  }

  setPreviewTuning(nextPreviewTuning = {}) {
    this.previewTuning = sanitizePreviewTuning(nextPreviewTuning);

    if (this.hemiLight) this.hemiLight.intensity = this.previewTuning.ambientLightIntensity;
    if (this.keyLight) this.keyLight.intensity = this.previewTuning.keyLightIntensity;
    this.applyCardMaterialRoughness(this.previewTuning.cardMaterialRoughness);

    if ((this.state.mode === 'preview' || this.state.mode === 'preview-return') && this.state.activeCard) {
      const previewOffsets = this.getResolvedPreviewOffsets();
      this.setActiveCardPose(
        new THREE.Vector3(
          PREVIEW_BASE_POSITION.x + previewOffsets.x,
          PREVIEW_BASE_POSITION.y + previewOffsets.y,
          PREVIEW_BASE_POSITION.z + previewOffsets.z,
        ),
        this.previewTuning.rotationX,
        0,
        0,
      );
    }
  }

  setCardAsActive(card, mode) {
    this.state.activeCard = card;
    this.state.mode = mode;
    this.state.previewStartedAt = performance.now();
    card.renderOrder = 10;
    this.applySelectionGlow(card);
    card.userData.tiltPivot.rotation.set(0, 0, 0);
    if (mode === 'preview') {
      this.state.previewOriginPose.position.copy(card.position);
      this.state.previewOriginPose.rotation.copy(card.rotation);
      beginPreviewTransition(this.state, this.state.previewStartedAt);
      const previewOffsets = this.getResolvedPreviewOffsets();
      this.setActiveCardPose(
        new THREE.Vector3(
          PREVIEW_BASE_POSITION.x + previewOffsets.x,
          PREVIEW_BASE_POSITION.y + previewOffsets.y,
          PREVIEW_BASE_POSITION.z + previewOffsets.z,
        ),
        this.previewTuning.rotationX,
        0,
        0,
      );
    }
    else this.setActiveCardPose(card.position, CARD_FACE_ROTATION_X + 0.24, 0, 0);
    this.setStatus(mode === 'drag'
      ? `Dragging ${card.userData.cardId}. Release to commit to a board slot.`
      : `Previewing ${card.userData.cardId}.`);
    if (mode === 'preview') this.updateAbilityPanelHighlights(card, { interactive: true });
  }

  applyCardMaterialRoughness(roughness) {
    const clampedRoughness = THREE.MathUtils.clamp(roughness, 0, 1);
    for (const card of this.cards) {
      const bodyMaterial = card.userData?.mesh?.material;
      if (bodyMaterial && typeof bodyMaterial.roughness === 'number') {
        bodyMaterial.roughness = clampedRoughness;
        bodyMaterial.needsUpdate = true;
      }

      const faceMaterial = card.userData?.face?.material;
      if (faceMaterial && typeof faceMaterial.roughness === 'number') {
        faceMaterial.roughness = clampedRoughness;
        faceMaterial.needsUpdate = true;
      }
    }
  }

  clearActiveCard({ restore = true, preserveSelectedAbility = false } = {}) {
    if (!this.state.activeCard) return;
    const card = this.state.activeCard;
    card.renderOrder = 0;
    card.userData.mesh.material.color.setHex(0x000000);
    card.userData.tiltPivot.rotation.set(0, 0, 0);
    card.scale.setScalar(1);
    if (restore) this.relayoutBoardAndHand();
    this.state.activeCard = null;
    this.state.mode = 'idle';
    this.state.dropSlotIndex = null;
    this.state.previewTransition.isActive = false;
    this.updateAbilityPanelHighlights(card, { interactive: false, preserveSelectedAbility });
  }


  getAbilityPanelIndexFromHit(card, hit) {
    const uv = hit?.uv;
    if (!card?.userData?.catalogCard || !uv || hit?.hitObject !== card.userData.face) return null;

    const cardKind = resolveCardKind(card.userData.catalogCard.cardKind);
    const layout = getDefaultCardLabelLayout(cardKind);
    const abilityBannerLayout = layout.abilityBanner;
    const abilityOffsets = [layout.ability1, layout.ability2];
    const abilities = [card.userData.catalogCard.ability1, card.userData.catalogCard.ability2];
    const textureX = uv.x * CARD_LABEL_CANVAS_SIZE;
    const textureY = (1 - uv.y) * CARD_LABEL_CANVAS_SIZE;
    const width = abilityBannerLayout.boxWidth * abilityBannerLayout.size;
    const height = abilityBannerLayout.boxHeight * abilityBannerLayout.size;

    for (let index = 0; index < abilityOffsets.length; index += 1) {
      if (!abilities[index]) continue;
      const anchorX = abilityBannerLayout.x + abilityOffsets[index].x;
      const anchorY = abilityBannerLayout.y + abilityOffsets[index].y;
      const left = anchorX - (width / 2);
      const top = anchorY - (height / 2);
      if (textureX >= left && textureX <= left + width && textureY >= top && textureY <= top + height) {
        return index;
      }
    }

    return null;
  }

  updateAbilityPanelHighlights(card, { interactive = false, preserveSelectedAbility = false } = {}) {
    if (!card?.userData?.catalogCard) return;
    const canInteract = interactive && this.canInteractWithCardAbilities(card);
    const outlineIndices = canInteract
      ? [card.userData.catalogCard.ability1, card.userData.catalogCard.ability2]
        .map((ability, index) => (ability ? index : null))
        .filter(Number.isInteger)
      : null;
    card.userData.abilityOutlineIndices = outlineIndices;
    if (!interactive && !preserveSelectedAbility) card.userData.selectedAbilityIndex = null;
    this.refreshCardFace(card);
  }

  getAbilityTargetType(ability) {
    const target = String(ability?.target || '').toLowerCase();
    return TARGET_TYPES[target] || TARGET_TYPES.none;
  }

  isSpellCard(card) {
    return resolveCardKind(card?.userData?.catalogCard?.cardKind) === 'Spell';
  }

  canInteractWithCardAbilities(card) {
    if (!card || this.options?.interactionLocked || this.state.spellResolutionInProgress) return false;
    if (this.isSpellCard(card)) {
      return card.userData.zone === CARD_ZONE_TYPES.HAND && card.userData.owner === this.template.playerSide;
    }
    return this.canCardAttack(card);
  }

  selectAbilityForActiveCard(ability, index) {
    const card = this.state.activeCard;
    if (!card || this.state.mode !== 'preview') return;
    if (!this.canInteractWithCardAbilities(card)) return;
    const targetType = this.getAbilityTargetType(ability);
    card.userData.selectedAbilityIndex = index;
    this.refreshCardFace(card);
    this.state.selectedAbilityByCardId.set(card.userData.cardId, {
      index,
      targetType,
      name: ability?.name || `Ability ${index + 1}`,
    });
    this.state.pendingAbilitySelection = {
      sourceCardId: card.userData.cardId,
      sourceSlotIndex: card.userData.slotIndex,
      targetType,
    };
    this.beginPreviewReturn();
    if (targetType === TARGET_TYPES.none) {
      this.commitAbilitySelection({ card, targetSlotIndex: null, targetSide: null });
      return;
    }
    this.highlightValidTargetsForPendingAbility();
    this.setStatus(`Select a ${targetType} target for ${card.userData.cardId}.`);
  }

  getCardsForTargetType(targetType, sourceCard) {
    if (!sourceCard) return [];
    const sourceIsSpellInHand = this.isSpellCard(sourceCard) && sourceCard.userData.zone === CARD_ZONE_TYPES.HAND;
    if (targetType === TARGET_TYPES.self) return sourceIsSpellInHand ? [] : [sourceCard];
    if (targetType === TARGET_TYPES.friendly) {
      return this.cards.filter((card) => card.userData.zone === CARD_ZONE_TYPES.BOARD && card.userData.owner === sourceCard.userData.owner);
    }
    if (targetType === TARGET_TYPES.enemy) {
      return this.cards.filter((card) => card.userData.zone === CARD_ZONE_TYPES.BOARD && card.userData.owner !== sourceCard.userData.owner);
    }
    return [];
  }

  highlightValidTargetsForPendingAbility() {
    const pending = this.state.pendingAbilitySelection;
    const sourceCard = this.getCardById(pending?.sourceCardId);
    if (!pending || !sourceCard) return;
    this.clearHighlights();
    this.getCardsForTargetType(pending.targetType, sourceCard).forEach((card) => this.applySelectionGlow(card));
  }

  parseDieSides(value, fallback = 6) {
    if (typeof value !== 'string') return fallback;
    const match = value.trim().match(/d\s*(\d+)/i);
    const sides = Number.parseInt(match?.[1] || '', 10);
    return Number.isFinite(sides) ? Math.max(2, sides) : fallback;
  }

  parseSpellRollOutcome(value) {
    const outcome = Number(value);
    if (!Number.isFinite(outcome) || outcome < 1) return null;
    return outcome;
  }

  createSpellRollerPanel(card) {
    const host = this.canvas?.parentElement;
    if (!host || !card) return null;

    if (!this.state.spellRollerLayer || !this.state.spellRollerLayer.isConnected) {
      const layer = document.createElement('div');
      layer.className = 'card-roller-overlay-layer';
      host.append(layer);
      this.state.spellRollerLayer = layer;
    }

    const panel = document.createElement('div');
    panel.className = 'card-roller-overlay-panel';
    panel.dataset.state = 'pending';
    panel.title = 'Click to roll spell EFCT die';
    panel.style.left = '0';
    panel.style.top = '0';
    this.state.spellRollerLayer.dataset.active = 'true';
    this.state.spellRollerLayer.append(panel);
    return panel;
  }

  buildCardMeshConfigFromSnapshot(cardSnapshot, fallbackId) {
    const catalogCard = cardSnapshot?.catalogCard || null;
    const cardKind = catalogCard?.cardKind;
    const faceTexture = catalogCard
      ? createCardLabelTexture(catalogCard, {
        backgroundImagePath: getDefaultCardBackgroundImagePath(cardKind),
      })
      : null;

    return {
      id: cardSnapshot?.id || fallbackId,
      width: 1.8,
      height: 2.5,
      thickness: 0.08,
      cornerRadius: 0.15,
      color: cardSnapshot?.color ?? 0x8249d0,
      faceTexture,
    };
  }

  async waitForSpellRoll({ card, rollType, dieSides }) {
    this.clearSpellRollerPanel();
    const panel = this.createSpellRollerPanel(card);
    if (!panel) return null;

    const roller = new DieRollerClient({ container: panel, assets: {} });
    this.state.activeSpellRoller = { panel, roller, card };
    roller.renderStaticPreview(dieSides);
    this.positionSpellRollerPanel();
    const dieId = `${card.userData.cardId}-${rollType}`;

    return new Promise((resolve, reject) => {
      let rolled = false;
      const cleanup = () => {
        panel.removeEventListener('pointerdown', triggerRoll);
        panel.removeEventListener('click', triggerRoll);
        panel.removeEventListener('touchstart', triggerRoll);
      };

      const triggerRoll = async (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (rolled) return;
        rolled = true;
        panel.dataset.state = 'rolling';
        cleanup();
        try {
          const settled = new Promise((settledResolve, settledReject) => {
            roller.handlers.onSettled = ({ value }) => settledResolve(value ?? null);
            roller.handlers.onError = (error) => settledReject(error);
          });
          const payload = await roller.roll({ dice: [{ id: dieId, sides: dieSides }] });
          const settledValue = await settled;
          const outcome = Number(payload?.results?.[0]?.roll?.outcome);
          const roll = payload?.results?.[0]?.roll || null;
          const normalizedOutcome = Number.isFinite(settledValue) ? settledValue : outcome;
          panel.dataset.state = 'settled';
          resolve({
            outcome: Number.isFinite(normalizedOutcome) ? normalizedOutcome : null,
            roll,
            sides: dieSides,
          });
        } catch (error) {
          reject(error);
        }
      };

      panel.addEventListener('pointerdown', triggerRoll);
      panel.addEventListener('click', triggerRoll);
      panel.addEventListener('touchstart', triggerRoll, { passive: false });
    });
  }

  async waitForRemoteSpellRoll({ spellResolution, card, dieSides }) {
    this.clearSpellRollerPanel();
    const panel = this.createSpellRollerPanel(card);
    if (!panel) return null;

    panel.title = 'Waiting for caster roll';
    panel.dataset.state = 'waiting';
    const roller = new DieRollerClient({ container: panel, assets: {} });
    this.state.activeSpellRoller = { panel, roller, card };
    roller.renderStaticPreview(dieSides);
    this.positionSpellRollerPanel();

    let liveSpellResolution = spellResolution;
    let outcome = this.parseSpellRollOutcome(liveSpellResolution?.rollOutcome);
    const settled = new Promise((resolve, reject) => {
      roller.handlers.onSettled = ({ value }) => resolve(value ?? null);
      roller.handlers.onError = (error) => reject(error);
    });

    while (!Number.isFinite(outcome)) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const latest = typeof this.getSpellResolutionSnapshot === 'function'
        ? this.getSpellResolutionSnapshot()
        : null;
      if (latest && latest.id === spellResolution.id) {
        liveSpellResolution = latest;
        outcome = this.parseSpellRollOutcome(latest.rollOutcome);
      }
    }

    panel.dataset.state = 'rolling';
    const remoteRoll = liveSpellResolution?.rollData;
    const remoteRollSides = Number.isInteger(remoteRoll?.sides) ? remoteRoll.sides : dieSides;
    if (remoteRoll?.roll && Array.isArray(remoteRoll.roll.frames) && remoteRoll.roll.frames.length) {
      roller.playRoll({ roll: remoteRoll.roll, sides: remoteRollSides });
      await settled;
    }
    panel.dataset.state = 'settled';

    return {
      outcome,
      rollType: liveSpellResolution?.rollType || 'damage',
      resolution: liveSpellResolution,
    };
  }


  positionSpellRollerPanel() {
    const active = this.state.activeSpellRoller;
    if (!active?.panel || !active?.card) return;
    const projected = active.card.position.clone();
    projected.y += 0.62;
    projected.project(this.camera);
    const size = this.renderer.getSize(new THREE.Vector2());
    const x = (projected.x * 0.5 + 0.5) * size.x;
    const y = (-projected.y * 0.5 + 0.5) * size.y;
    const canvasRect = this.canvas.getBoundingClientRect();
    const layerRect = (this.state.spellRollerLayer || this.canvas.parentElement).getBoundingClientRect();
    const xInLayer = x + (canvasRect.left - layerRect.left);
    const yInLayer = y + (canvasRect.top - layerRect.top);
    const panelSize = Math.max(72, Math.min(98, (this.canvas.parentElement?.clientWidth || size.x) * 0.14));
    active.panel.style.width = `${panelSize}px`;
    active.panel.style.height = `${panelSize}px`;
    active.panel.style.transform = `translate(${xInLayer - panelSize / 2}px, ${yInLayer - panelSize / 2}px)`;
  }
  clearSpellRollerPanel() {
    const active = this.state.activeSpellRoller;
    if (!active) return;
    active.roller?.destroy?.();
    active.panel?.remove();
    if (this.state.spellRollerLayer) this.state.spellRollerLayer.dataset.active = 'false';
    this.state.activeSpellRoller = null;
  }

  queueSpellAttackAnimation(card, targetCard) {
    if (!card || !targetCard) return;
    const resolvedDamage = Number.isFinite(targetCard?.userData?.pendingSpellDamage)
      ? targetCard.userData.pendingSpellDamage
      : null;
    const resolvedHealing = Number.isFinite(targetCard?.userData?.pendingSpellHealing)
      ? targetCard.userData.pendingSpellHealing
      : null;
    if (targetCard?.userData) {
      targetCard.userData.pendingSpellDamage = null;
      targetCard.userData.pendingSpellHealing = null;
    }
    const startAtMs = performance.now();
    this.combatAnimations.push({
      attackerCard: card,
      defenderCard: targetCard,
      originPosition: card.position.clone(),
      defenderPosition: targetCard.position.clone(),
      startAtMs,
      durationMs: 760,
      resolvedDamage,
      resolvedHealing,
      didHit: false,
      initialized: true,
    });
  }

  resolveSpellAbilityValue(ability, rollOutcome) {
    if (!ability || ability.valueSourceType === 'none') return 0;
    if (ability.valueSourceType === 'fixed') {
      const fixedValue = Number(ability.valueSourceFixed);
      return Number.isFinite(fixedValue) ? Math.max(0, Math.floor(fixedValue)) : 0;
    }

    const parsedOutcome = Number(rollOutcome);
    return Number.isFinite(parsedOutcome) ? Math.max(0, Math.floor(parsedOutcome)) : 0;
  }

  async runSpellResolution({ card, targetCard, selectedAbility }) {
    const rollType = selectedAbility?.valueSourceStat === 'efct' ? 'damage' : (selectedAbility?.valueSourceStat || 'damage');
    const dieSides = this.parseDieSides(card.userData.catalogCard?.[rollType], 6);

    let spellResolutionId = null;
    if (typeof this.onSpellResolutionRequested === 'function') {
      try {
        const response = await this.onSpellResolutionRequested({
          card,
          targetCard,
          selectedAbility,
          rollType,
          dieSides,
        });
        spellResolutionId = response?.id || null;
      } catch (error) {
        this.setStatus(`Spell start sync failed: ${error.message}`);
        return;
      }
    }

    this.state.spellResolutionInProgress = true;
    this.state.activeSpellResolutionId = spellResolutionId;
    this.options = { ...this.options, interactionLocked: true };
    this.clearHighlights();
    card.userData.locked = true;

    const startedFromPreview = this.state.activeCard === card
      && (this.state.mode === 'preview' || this.state.mode === 'preview-return');
    const startPosition = startedFromPreview
      ? this.state.previewOriginPose.position.clone()
      : card.position.clone();
    const startRotation = startedFromPreview
      ? this.state.previewOriginPose.rotation.clone()
      : card.rotation.clone();

    if (startedFromPreview) {
      this.updateAbilityPanelHighlights(card, { interactive: false });
      this.state.activeCard = null;
      this.state.mode = 'idle';
      this.state.previewTransition.isActive = false;
      card.renderOrder = 0;
      card.userData.mesh.material.color.setHex(0x000000);
      card.userData.tiltPivot.rotation.set(0, 0, 0);
      card.scale.setScalar(1);
      card.position.copy(startPosition);
      card.rotation.copy(startRotation);
    }

    const centerPosition = SPELL_CENTER_POSITION.clone();
    const centerStart = performance.now();
    this.cardAnimations.push({
      card,
      startAtMs: centerStart,
      durationMs: 760,
      fromPosition: startPosition,
      fromRotation: startRotation,
      targetPosition: centerPosition,
      targetRotation: new THREE.Euler(CARD_FACE_ROTATION_X, 0, 0),
      arcHeight: 0.7,
      swirlAmplitude: 0.15,
      scaleFrom: 1,
      scaleTo: 1.06,
      onComplete: () => {},
    });

    await new Promise((resolve) => window.setTimeout(resolve, 860));
    let spellRoll = null;
    try {
      spellRoll = await this.waitForSpellRoll({ card, rollType, dieSides });
    } catch (error) {
      this.setStatus(`Spell roll failed: ${error.message}`);
    } finally {
      this.clearSpellRollerPanel();
    }
    let outcome = Number(spellRoll?.outcome);
    if (!Number.isFinite(outcome)) {
      outcome = 1 + Math.floor(Math.random() * dieSides);
    }
    this.setCardStatDisplayOverride(card.userData.cardId, rollType, outcome);

    if (spellResolutionId && typeof this.onSpellRollResolved === 'function') {
      try {
        await this.onSpellRollResolved({
          spellId: spellResolutionId,
          rollOutcome: outcome,
          rollType,
          rollData: spellRoll?.roll ? {
            roll: spellRoll.roll,
            sides: spellRoll.sides,
          } : null,
        });
      } catch (error) {
        this.setStatus(`Spell roll sync failed: ${error.message}`);
      }
    }

    if (targetCard) {
      const resolvedValue = this.resolveSpellAbilityValue(selectedAbility, outcome);
      targetCard.userData.pendingSpellDamage = selectedAbility?.effectId === 'damage_enemy' ? resolvedValue : null;
      targetCard.userData.pendingSpellHealing = selectedAbility?.effectId === 'heal_target' ? resolvedValue : null;
      this.queueSpellAttackAnimation(card, targetCard);
      await new Promise((resolve) => window.setTimeout(resolve, 760));
    }

    await new Promise((resolve) => window.setTimeout(resolve, SPELL_ATTACK_DELAY_AFTER_IMPACT_MS));
    this.beginCardDeathAnimation(card, new THREE.Vector3(0, 0, -1), performance.now());
    card.userData.zone = CARD_ZONE_TYPES.DISCARD;
    card.userData.slotIndex = null;
    await this.notifyCardStateCommitted(card);
    await new Promise((resolve) => window.setTimeout(resolve, SPELL_DEATH_SETTLE_WAIT_MS));

    if (spellResolutionId && typeof this.onSpellResolutionFinished === 'function') {
      try {
        await this.onSpellResolutionFinished({ spellId: spellResolutionId });
      } catch (error) {
        this.setStatus(`Spell completion sync failed: ${error.message}`);
      }
    }

    this.state.activeSpellResolutionId = null;
    this.state.spellResolutionInProgress = false;
    this.options = { ...this.options, interactionLocked: false };
  }

  async playRemoteSpellResolution(spellResolution) {
    if (!spellResolution || !spellResolution.id) return false;
    if (this.state.remoteSpellResolutionPromise && this.state.activeSpellResolutionId === spellResolution.id) return false;

    let card = this.getCardById(spellResolution.cardId);
    let createdProxyCard = false;
    if (!card) {
      card = CardMeshFactory.createCard(this.buildCardMeshConfigFromSnapshot(
        spellResolution.cardSnapshot,
        spellResolution.cardId || `remote-spell-${spellResolution.id}`,
      ));
      card.userData.zone = CARD_ZONE_TYPES.HAND;
      card.userData.slotIndex = null;
      card.userData.owner = spellResolution.casterSide === 'player' ? this.template.playerSide : 'opponent';
      card.userData.cardId = spellResolution.cardId;
      card.userData.catalogCard = spellResolution.cardSnapshot?.catalogCard || null;
      card.userData.statDisplayOverrides = null;
      card.userData.locked = true;
      card.scale.setScalar(1);
      const { y, z } = this.getBoardRotationForCard(card);
      card.rotation.set(CARD_FACE_ROTATION_X, y, z);
      const opponentDeckSlot = this.deckSlots.find((slot) => slot.side !== this.template.playerSide) || null;
      if (opponentDeckSlot) {
        card.position.set(opponentDeckSlot.x, HAND_CARD_BASE_Y, opponentDeckSlot.z);
      } else {
        card.position.set(0, HAND_CARD_BASE_Y, HAND_BASE_Z - 1.2);
      }
      this.scene.add(card);
      this.cards.push(card);
      this.picker.setCards(this.cards);
      createdProxyCard = true;
    }

    const targetSlotIndex = Number.isInteger(spellResolution.targetSlotIndex) ? spellResolution.targetSlotIndex : null;
    const targetSide = spellResolution.targetSide === 'player' || spellResolution.targetSide === 'opponent'
      ? spellResolution.targetSide
      : null;
    const resolvedTargetSlot = targetSlotIndex == null
      ? null
      : (targetSide === this.template.playerSide ? targetSlotIndex + this.zoneFramework.boardSlotsPerSide : targetSlotIndex);
    const targetCard = resolvedTargetSlot == null
      ? null
      : this.cards.find((entry) => entry.userData.zone === CARD_ZONE_TYPES.BOARD && entry.userData.slotIndex === resolvedTargetSlot) || null;

    const run = async () => {
      this.state.activeSpellResolutionId = spellResolution.id;
      this.state.spellResolutionInProgress = true;
      this.options = { ...this.options, interactionLocked: true };
      card.userData.locked = true;
      this.clearHighlights();

      const startPosition = card.position.clone();
      const startRotation = card.rotation.clone();
      this.cardAnimations.push({
        card,
        startAtMs: performance.now(),
        durationMs: 760,
        fromPosition: startPosition,
        fromRotation: startRotation,
        targetPosition: SPELL_CENTER_POSITION.clone(),
        targetRotation: new THREE.Euler(CARD_FACE_ROTATION_X, 0, 0),
        arcHeight: 0.7,
        swirlAmplitude: 0.15,
        scaleFrom: 1,
        scaleTo: 1.06,
        onComplete: () => {},
      });
      await new Promise((resolve) => window.setTimeout(resolve, 860));

      let remoteRoll = null;
      try {
        remoteRoll = await this.waitForRemoteSpellRoll({ spellResolution, card, dieSides: spellResolution.dieSides || 6 });
      } finally {
        this.clearSpellRollerPanel();
      }
      const liveSpellResolution = remoteRoll?.resolution || spellResolution;
      const outcome = Number(remoteRoll?.outcome);
      if (Number.isFinite(outcome)) {
        this.setCardStatDisplayOverride(card.userData.cardId, liveSpellResolution.rollType || 'damage', outcome);
      }

      if (targetCard) {
        const resolvedDamage = Number.isFinite(liveSpellResolution?.resolvedDamage)
          ? Math.max(0, Math.floor(Number(liveSpellResolution.resolvedDamage)))
          : null;
        const resolvedHealing = Number.isFinite(liveSpellResolution?.resolvedHealing)
          ? Math.max(0, Math.floor(Number(liveSpellResolution.resolvedHealing)))
          : null;
        targetCard.userData.pendingSpellDamage = resolvedDamage;
        targetCard.userData.pendingSpellHealing = resolvedHealing;
        this.queueSpellAttackAnimation(card, targetCard);
        await new Promise((resolve) => window.setTimeout(resolve, 760));
      }

      await new Promise((resolve) => window.setTimeout(resolve, SPELL_ATTACK_DELAY_AFTER_IMPACT_MS));
      this.beginCardDeathAnimation(card, new THREE.Vector3(0, 0, -1), performance.now());
      card.userData.zone = CARD_ZONE_TYPES.DISCARD;
      card.userData.slotIndex = null;
      await new Promise((resolve) => window.setTimeout(resolve, SPELL_DEATH_SETTLE_WAIT_MS));

      if (createdProxyCard) {
        this.scene.remove(card);
        const cardIndex = this.cards.indexOf(card);
        if (cardIndex >= 0) this.cards.splice(cardIndex, 1);
        this.picker.setCards(this.cards);
      }
      this.state.remoteSpellResolutionPromise = null;
      this.state.activeSpellResolutionId = null;
      this.state.spellResolutionInProgress = false;
      this.options = { ...this.options, interactionLocked: false };
    };

    this.state.remoteSpellResolutionPromise = run();
    await this.state.remoteSpellResolutionPromise;
    return true;
  }

  async commitAbilitySelection({ card, targetSlotIndex, targetSide, targetCard = null }) {
    const selectedAbility = Number.isInteger(card.userData.selectedAbilityIndex)
      ? (card.userData.selectedAbilityIndex === 0 ? card.userData.catalogCard?.ability1 : card.userData.catalogCard?.ability2)
      : card.userData.catalogCard?.ability1;

    if (this.isSpellCard(card) && card.userData.zone === CARD_ZONE_TYPES.HAND) {
      await this.runSpellResolution({ card, targetCard, selectedAbility });
      this.state.pendingAbilitySelection = null;
      this.clearHighlights();
      return;
    }

    card.userData.attackCommitted = true;
    card.userData.committedAbilityIndex = Number.isInteger(card.userData.selectedAbilityIndex)
      ? card.userData.selectedAbilityIndex
      : 0;
    card.userData.targetSlotIndex = Number.isInteger(targetSlotIndex) ? targetSlotIndex : null;
    card.userData.targetSide = targetSide || null;
    await this.notifyCardStateCommitted(card);
    this.state.pendingAbilitySelection = null;
    this.clearHighlights();
  }

  beginPreviewReturn() {
    const card = this.state.activeCard;
    if (!card || this.state.mode !== 'preview') return false;
    this.state.mode = 'preview-return';
    this.state.previewStartedAt = performance.now();
    beginPreviewReturnTransition(this.state, this.state.previewStartedAt);
    this.setStatus(`Preview closing for ${card.userData.cardId}.`);
    return true;
  }

  getPointerDistanceFromPress(event) {
    const dx = event.clientX - this.state.pressPointer.x;
    const dy = event.clientY - this.state.pressPointer.y;
    return Math.hypot(dx, dy);
  }

  eventToNdc(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  pointerToBoardPoint(event) {
    this.eventToNdc(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, this.planePoint)) return null;
    return this.planePoint;
  }

  findNearestSlot(worldPoint, maxDistance = 1.25) {
    let closest = null;
    let closestDist = Infinity;
    for (const slot of this.boardSlots) {
      if (slot.side !== this.template.playerSide) continue;
      if (slot.card && slot.card !== this.state.activeCard) continue;
      const d = Math.hypot(worldPoint.x - slot.x, worldPoint.z - slot.z);
      if (d < closestDist) {
        closest = slot;
        closestDist = d;
      }
    }
    if (!closest || closestDist > maxDistance) return null;
    return closest;
  }

  updateDragPoseFromPointer(event) {
    const card = this.state.activeCard;
    if (!card) return;
    const point = this.pointerToBoardPoint(event);
    if (!point) return;
    this.setActiveCardPose(point.clone().setY(0.35), CARD_FACE_ROTATION_X + 0.24, 0, 0);

    const slot = this.findNearestSlot(point);
    this.state.dropSlotIndex = slot?.index ?? null;

    for (const boardSlot of this.boardSlots) {
      if (boardSlot.side !== this.template.playerSide) {
        boardSlot.mesh.material.opacity = 0.17;
        continue;
      }
      boardSlot.mesh.material.opacity = boardSlot.index === this.state.dropSlotIndex ? 0.55 : 0.2;
    }
  }

  findNearestEnemyBoardSlot(worldPoint, maxDistance = 1.25) {
    let closest = null;
    let closestDist = Infinity;
    for (const slot of this.boardSlots) {
      if (slot.side === this.template.playerSide) continue;
      if (!slot.card) continue;
      const d = Math.hypot(worldPoint.x - slot.x, worldPoint.z - slot.z);
      if (d < closestDist) {
        closest = slot;
        closestDist = d;
      }
    }
    if (!closest || closestDist > maxDistance) return null;
    return closest;
  }

  updateAttackTargetPoseFromPointer(event) {
    const card = this.state.activeCard;
    if (!card) return;
    const point = this.pointerToBoardPoint(event);
    if (!point) return;

    this.setActiveCardPose(point.clone().setY(0.45), CARD_FACE_ROTATION_X + 0.18, 0, 0);
    const targetSlot = this.findNearestEnemyBoardSlot(point);
    this.state.dropTargetSlotIndex = targetSlot?.index ?? null;
    this.clearAttackTargetHover();
    if (targetSlot?.card) {
      targetSlot.card.scale.setScalar(ATTACK_TARGET_SCALE);
      targetSlot.card.userData.isAttackHover = true;
    }
  }

  beginDrag(card) {
    if (!card) return;
    if (!this.state.pendingCardDidPickup && this.state.dragOrigin) {
      if (card.userData.zone === CARD_ZONE_TYPES.BOARD && Number.isInteger(card.userData.slotIndex)) this.boardSlots[card.userData.slotIndex].card = null;
      this.sendCardEvent(card.userData.cardId, 'pickup', { zone: this.state.dragOrigin.zone });
      this.state.pendingCardDidPickup = true;
    }
    if (this.state.mode === 'idle') this.setCardAsActive(card, 'drag');
    else {
      this.state.mode = 'drag';
      this.state.previewTransition.isActive = false;
      this.setStatus(`Dragging ${card.userData.cardId}. Release to commit to a board slot.`);
    }
    window.clearTimeout(this.state.holdTimer);
    this.state.holdTimer = 0;
  }

  canCardAttack(card) {
    if (!card) return false;
    if (card.userData.zone !== CARD_ZONE_TYPES.BOARD) return false;
    if (card.userData.owner !== this.template.playerSide) return false;
    if (card.userData.canAttack !== true) return false;
    if (card.userData.attackCommitted === true) return false;
    return true;
  }

  canCardDrag(card) {
    if (!card) return false;
    if (this.isSpellCard(card)) return false;
    if (card.userData.zone === CARD_ZONE_TYPES.HAND && card.userData.owner === this.template.playerSide) return true;
    return false;
  }

  async loadCardState() {
    try {
      const payload = await this.net.listCards();
      const known = payload.cards?.length ?? 0;
      this.setStatus(`Ready. Zone framework active (hand/board/deck/discard/exile/staging/stack/resolving). Each side has exactly 3 board slots and 1 deck slot. Server knows ${known} cards.`);
    } catch (error) {
      this.setStatus(`Ready. Zone framework active (hand/board/deck/discard/exile/staging/stack/resolving). Each side has exactly 3 board slots and 1 deck slot. Server sync unavailable (${error.message}).`);
    }
  }

  async sendCardEvent(cardId, action, extra = {}) {
    try {
      return await this.net.cardAction(cardId, action, extra);
    } catch (error) {
      this.setStatus(`Server comms error: ${error.message}`);
      return null;
    }
  }

  async notifyCardStateCommitted(card) {
    if (typeof this.onCardStateCommitted !== 'function' || !card) return;

    try {
      await this.onCardStateCommitted({
        cardId: card.userData.cardId,
        zone: card.userData.zone,
        slotIndex: card.userData.slotIndex,
        owner: card.userData.owner,
      });
    } catch (error) {
      this.setStatus(`State sync callback error: ${error.message}`);
    }
  }

  getCardById(cardId) {
    if (typeof cardId !== 'string') return null;
    return this.cards.find((card) => card?.userData?.cardId === cardId) || null;
  }

  refreshCardFace(card) {
    if (!card?.userData?.catalogCard || !card?.userData?.face) return;
    const cardKind = card.userData.catalogCard.cardKind;
    const texture = createCardLabelTexture(card.userData.catalogCard, {
      backgroundImagePath: getDefaultCardBackgroundImagePath(cardKind),
      statDisplayOverrides: card.userData.statDisplayOverrides || null,
      abilityOutlineIndices: card.userData.abilityOutlineIndices || null,
      selectedAbilityIndex: Number.isInteger(card.userData.selectedAbilityIndex) ? card.userData.selectedAbilityIndex : null,
    });
    card.userData.face.material.map = texture;
    card.userData.face.material.needsUpdate = true;
  }

  setCardStatDisplayOverride(cardId, statKey, value) {
    const card = this.getCardById(cardId);
    if (!card) return false;
    if (!card.userData.statDisplayOverrides) card.userData.statDisplayOverrides = {};
    card.userData.statDisplayOverrides[statKey] = value;
    this.refreshCardFace(card);
    return true;
  }

  clearCardStatDisplayOverrides() {
    this.cards.forEach((card) => {
      if (!card?.userData?.statDisplayOverrides) return;
      card.userData.statDisplayOverrides = null;
      this.refreshCardFace(card);
    });
  }

  resetDemo() {
    this.clearSpellRollerPanel();
    this.clearHighlights();
    this.clearActiveCard({ restore: false });
    window.clearTimeout(this.state.holdTimer);
    this.state.holdTimer = 0;
    this.state.activePointerId = null;
    this.boardSlots.forEach((slot) => { slot.card = null; });
    this.cardAnimations.length = 0;

    for (const card of this.cards) this.scene.remove(card);
    this.cards.length = 0;
    this.discardedCardSnapshotsById.clear();

    for (const cfg of this.template.initialCards) {
      const cardKind = cfg.catalogCard?.cardKind;
      const faceTexture = cfg.catalogCard
        ? createCardLabelTexture(cfg.catalogCard, {
          backgroundImagePath: getDefaultCardBackgroundImagePath(cardKind),
        })
        : null;
      const card = CardMeshFactory.createCard({
        id: cfg.id,
        width: 1.8,
        height: 2.5,
        thickness: 0.08,
        cornerRadius: 0.15,
        color: cfg.color,
        faceTexture,
      });
      card.userData.zone = isKnownZone(cfg.zone, this.zoneFramework) ? cfg.zone : CARD_ZONE_TYPES.HAND;
      card.userData.slotIndex = cfg.slotIndex ?? null;
      card.userData.owner = cfg.owner ?? this.template.playerSide;
      card.userData.dealOrder = cfg.dealOrder ?? null;
      card.userData.shouldDealAnimate = cfg.shouldDealAnimate === true;
      card.userData.locked = false;
      card.userData.isAnimating = false;
      card.userData.canAttack = cfg.canAttack === true;
      card.userData.attackCommitted = cfg.attackCommitted === true;
      card.userData.selectedAbilityIndex = Number.isInteger(cfg.selectedAbilityIndex)
        ? cfg.selectedAbilityIndex
        : null;
      card.userData.committedAbilityIndex = card.userData.attackCommitted === true
        ? (Number.isInteger(cfg.committedAbilityIndex)
          ? cfg.committedAbilityIndex
          : (Number.isInteger(cfg.selectedAbilityIndex) ? cfg.selectedAbilityIndex : null))
        : null;
      card.userData.targetSlotIndex = Number.isInteger(cfg.targetSlotIndex) ? cfg.targetSlotIndex : null;
      card.userData.targetSide = cfg.targetSide || null;
      card.userData.catalogCard = cfg.catalogCard ?? null;
      card.userData.statDisplayOverrides = null;
      card.userData.isAttackHover = false;
      card.scale.setScalar(1);
      const { y, z } = this.getBoardRotationForCard(card);
      card.rotation.set(CARD_FACE_ROTATION_X, y, z);
      if (card.userData.zone === CARD_ZONE_TYPES.BOARD && Number.isInteger(cfg.slotIndex)) {
        const slot = this.boardSlots[cfg.slotIndex];
        if (slot) {
          slot.card = card;
          card.position.set(slot.x, 0, slot.z);
        }
      }
      this.scene.add(card);
      this.cards.push(card);
    }

    this.relayoutBoardAndHand();
    this.applyCardMaterialRoughness(this.previewTuning.cardMaterialRoughness);
    this.queueCardAnimationsFromHooks({ reason: 'reset' });
    this.picker.setCards(this.cards);
    this.setStatus('Demo reset. Zone framework enabled with mirrored player/opponent zones; board remains capped at 3 slots per side and 1 deck slot per side.');
  }

  async handlePointerDown(event) {
    if (this.options?.interactionLocked || this.state.spellResolutionInProgress) return;
    if (this.state.mode === 'preview-return') return;
    if (this.state.activePointerId != null) return;
    this.canvasContainer.setPointerCapture(event.pointerId);
    this.state.activePointerId = event.pointerId;
    this.state.pressPointer.x = event.clientX;
    this.state.pressPointer.y = event.clientY;
    this.state.lastPointer.x = event.clientX;
    this.state.lastPointer.y = event.clientY;
    this.state.dropSlotIndex = null;
    this.state.pendingCardCanDrag = false;
    this.state.pendingCardDidPickup = false;

    const hit = this.picker.pickHit(event);
    const card = hit?.card ?? null;
    if (!card) {
      if (this.state.mode === 'preview' && this.beginPreviewReturn()) {
        this.clearHighlights();
      }
      this.state.activePointerId = null;
      this.state.pendingCard = null;
      this.state.pendingCardCanDrag = false;
      this.state.pendingCardDidPickup = false;
      if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
      this.setStatus('No card selected.');
      return;
    }

    if (card.userData.locked) {
      this.state.activePointerId = null;
      this.state.pendingCard = null;
      this.state.pendingCardCanDrag = false;
      this.state.pendingCardDidPickup = false;
      if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
      this.setStatus(`${card.userData.cardId} is still animating. Try again in a moment.`);
      return;
    }

    if (this.state.mode === 'preview' && this.state.activeCard === card) {
      const abilityIndex = this.getAbilityPanelIndexFromHit(card, hit);
      if (abilityIndex != null) {
        if (!this.canInteractWithCardAbilities(card)) {
          this.setStatus(`${card.userData.cardId} cannot use abilities right now.`);
          this.state.activePointerId = null;
          this.state.pendingCard = null;
          this.state.pendingCardCanDrag = false;
          this.state.pendingCardDidPickup = false;
          if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
          return;
        }
        const ability = abilityIndex === 0 ? card.userData.catalogCard?.ability1 : card.userData.catalogCard?.ability2;
        if (ability) {
          this.selectAbilityForActiveCard(ability, abilityIndex);
          this.state.activePointerId = null;
          this.state.pendingCard = null;
          this.state.pendingCardCanDrag = false;
          this.state.pendingCardDidPickup = false;
          if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
          return;
        }
      }
    }


    if (this.state.pendingAbilitySelection) {
      const pending = this.state.pendingAbilitySelection;
      const sourceCard = this.getCardById(pending.sourceCardId);
      const validTargets = this.getCardsForTargetType(pending.targetType, sourceCard);
      if (!validTargets.includes(card)) {
        this.setStatus('Invalid target for selected ability.');
        this.state.activePointerId = null;
        this.state.pendingCard = null;
        this.state.pendingCardCanDrag = false;
        this.state.pendingCardDidPickup = false;
        if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
        return;
      }
      await this.commitAbilitySelection({
        card: sourceCard,
        targetSlotIndex: card.userData.slotIndex,
        targetSide: card.userData.owner,
        targetCard: card,
      });
      this.setStatus(`Ability queued from ${sourceCard.userData.cardId}.`);
      this.state.activePointerId = null;
      this.state.pendingCard = null;
      this.state.pendingCardCanDrag = false;
      this.state.pendingCardDidPickup = false;
      if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
      return;
    }

    this.state.pendingCard = card;
    this.state.pendingCardCanDrag = this.canCardDrag(card);
    this.state.pendingCardDidPickup = false;
    this.clearHighlights();
    this.state.dragOrigin = { zone: card.userData.zone, slotIndex: card.userData.slotIndex };

  }

  handlePointerMove(event) {
    if (this.state.activePointerId !== event.pointerId) return;
    this.state.lastPointer.x = event.clientX;
    this.state.lastPointer.y = event.clientY;
    const distance = this.getPointerDistanceFromPress(event);
    const card = this.state.activeCard ?? this.state.pendingCard;

    if (this.state.mode === 'idle' && card && this.state.pendingCardCanDrag && distance > DRAG_START_DISTANCE_PX) {
      this.setCardAsActive(card, 'drag');
      this.beginDrag(card);
    }

    if (this.state.mode === 'drag' && this.state.activeCard) {
      event.preventDefault();
      this.updateDragPoseFromPointer(event);
    }
  }

  async endPointerInteraction(event, { commitDrop = true } = {}) {
    if (this.state.activePointerId !== event.pointerId) return;
    if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
    window.clearTimeout(this.state.holdTimer);
    this.state.holdTimer = 0;

    const card = this.state.activeCard;
    const prevOrigin = this.state.dragOrigin;

    if (!card && this.state.pendingCard && this.state.mode === 'idle') {
      this.setCardAsActive(this.state.pendingCard, 'preview');
      this.state.activePointerId = null;
      this.state.pendingCard = null;
      this.state.pendingCardCanDrag = false;
      this.state.pendingCardDidPickup = false;
      this.state.dragOrigin = null;
      return;
    }

    if (card && commitDrop && this.state.mode === 'drag' && this.state.dropSlotIndex != null) {
      const slot = this.boardSlots[this.state.dropSlotIndex];
      slot.card = card;
      card.userData.zone = CARD_ZONE_TYPES.BOARD;
      card.userData.slotIndex = slot.index;
      card.position.set(slot.x, 0, slot.z);
      const { y, z } = this.getBoardRotationForSlot(slot);
      card.rotation.set(CARD_FACE_ROTATION_X, y, z);
      await this.sendCardEvent(card.userData.cardId, 'putdown', { zone: CARD_ZONE_TYPES.BOARD, slotIndex: slot.index });
      card.userData.owner = this.template.playerSide;
      await this.notifyCardStateCommitted(card);
      this.setStatus(`Placed ${card.userData.cardId} into board slot ${slot.index + 1}.`);
    } else if (card) {
      if (this.state.mode === 'preview' && this.beginPreviewReturn()) {
        this.clearHighlights();
        this.state.activePointerId = null;
        this.state.pendingCard = null;
        this.state.pendingCardCanDrag = false;
        this.state.pendingCardDidPickup = false;
        this.state.dragOrigin = null;
        this.state.dropTargetSlotIndex = null;
        return;
      }

      if (prevOrigin?.zone === CARD_ZONE_TYPES.BOARD && Number.isInteger(prevOrigin.slotIndex)) {
        const slot = this.boardSlots[prevOrigin.slotIndex];
        slot.card = card;
        card.userData.zone = CARD_ZONE_TYPES.BOARD;
        card.userData.slotIndex = slot.index;
        card.position.set(slot.x, 0, slot.z);
      } else {
        card.userData.zone = CARD_ZONE_TYPES.HAND;
        card.userData.slotIndex = null;
      }
      const { y, z } = this.getBoardRotationForCard(card);
      card.rotation.set(CARD_FACE_ROTATION_X, y, z);
      if (this.state.pendingCardDidPickup) {
        await this.sendCardEvent(card.userData.cardId, 'putdown', { zone: card.userData.zone, slotIndex: card.userData.slotIndex });
        await this.notifyCardStateCommitted(card);
      }
      this.setStatus(this.state.mode === 'preview' ? `Preview closed for ${card.userData.cardId}.` : `Returned ${card.userData.cardId} to ${card.userData.zone}.`);
    }

    this.clearHighlights();
    this.clearActiveCard({ restore: true });
    this.relayoutBoardAndHand();

    this.state.activePointerId = null;
    this.state.pendingCard = null;
    this.state.pendingCardCanDrag = false;
    this.state.pendingCardDidPickup = false;
    this.state.dragOrigin = null;
    this.state.dropTargetSlotIndex = null;
  }

  getCombatDecisions() {
    const boardSlotsPerSide = Math.floor(this.boardSlots.length / 2);
    const normalizeToLocalSlotIndex = (slotIndex, side) => {
      if (!Number.isInteger(slotIndex)) return null;
      if (slotIndex < 0) return null;
      if (slotIndex < boardSlotsPerSide) return slotIndex;
      if (slotIndex < boardSlotsPerSide * 2 && side === this.template.playerSide) {
        return slotIndex - boardSlotsPerSide;
      }
      return null;
    };

    return this.cards
      .filter((card) => card.userData.owner === this.template.playerSide && card.userData.zone === CARD_ZONE_TYPES.BOARD)
      .filter((card) => card.userData.attackCommitted === true && Number.isInteger(card.userData.slotIndex))
      .map((card) => {
        const targetSide = card.userData.targetSide || null;
        const targetSlotIndex = normalizeToLocalSlotIndex(card.userData.targetSlotIndex, targetSide);

        return {
          attackerSlotIndex: normalizeToLocalSlotIndex(card.userData.slotIndex, this.template.playerSide),
          targetSlotIndex,
          targetSide,
          selectedAbilityIndex: Number.isInteger(card.userData.committedAbilityIndex)
            ? card.userData.committedAbilityIndex
            : (Number.isInteger(card.userData.selectedAbilityIndex) ? card.userData.selectedAbilityIndex : 0),
        };
      });
  }

  playCommitPhaseAnimations(attackPlan = [], { onDone, interAttackDelayMs = 720 } = {}) {
    if (!Array.isArray(attackPlan) || !attackPlan.length) {
      onDone?.();
      return;
    }

    const now = performance.now();
    attackPlan.forEach((step, index) => {
      this.combatAnimations.push({
        attackerSlotIndex: step?.attackerSlotIndex,
        targetSlotIndex: step?.targetSlotIndex,
        attackerSide: step?.attackerSide === 'opponent' ? 'opponent' : 'player',
        targetSide: step?.targetSide === 'player' || step?.targetSide === 'opponent' ? step.targetSide : 'opponent',
        startAtMs: now + index * interAttackDelayMs,
        durationMs: 760,
        resolvedDamage: Number.isFinite(step?.resolvedDamage) ? step.resolvedDamage : null,
        resolvedHealing: Number.isFinite(step?.resolvedHealing) ? step.resolvedHealing : null,
        retaliationDamage: Number.isFinite(step?.retaliationDamage) ? step.retaliationDamage : 0,
        retaliationAppliedDamage: Number.isFinite(step?.retaliationAppliedDamage) ? step.retaliationAppliedDamage : 0,
        defenseRemaining: Number.isFinite(step?.defenseRemaining) ? step.defenseRemaining : null,
        didHit: false,
        initialized: false,
      });
    });

    const latest = this.combatAnimations.reduce((max, item) => Math.max(max, item.startAtMs + item.durationMs), now);
    window.setTimeout(() => onDone?.(), Math.max(0, latest - now + 50));
  }

  applyCombatAnimations(time) {
    if (this.combatAnimations.length) {
      const pending = [];
      for (const animation of this.combatAnimations) {
        const elapsed = time - animation.startAtMs;
        if (elapsed < 0) {
          pending.push(animation);
          continue;
        }

        if (!animation.initialized) {
          animation.initialized = true;
          const resolved = this.resolveCombatAnimationSlots(animation);
          if (!resolved?.attackerSlot?.card || !resolved?.defenderSlot?.card) {
            continue;
          }
          animation.attackerCard = resolved.attackerSlot.card;
          animation.defenderCard = resolved.defenderSlot.card;
          animation.originPosition = new THREE.Vector3(resolved.attackerSlot.x, 0, resolved.attackerSlot.z);
          animation.defenderPosition = new THREE.Vector3(resolved.defenderSlot.x, 0, resolved.defenderSlot.z);
        }

        const t = THREE.MathUtils.clamp(elapsed / animation.durationMs, 0, 1);
        const card = animation.attackerCard;
        if (!card || !animation.defenderCard) continue;
        card.userData.locked = true;
        const origin = animation.originPosition;
        const defender = animation.defenderPosition;
        const attackAxis = defender.clone().sub(origin).setY(0).normalize();
        const chargePosition = origin.clone().addScaledVector(attackAxis, -0.32);
        chargePosition.y = 0.34;
        const impactPosition = defender.clone().addScaledVector(attackAxis, -0.08);
        impactPosition.y = 0.12;
        let pos = origin.clone();

        if (t < 0.24) {
          const windUp = t / 0.24;
          const easedWindUp = THREE.MathUtils.smootherstep(windUp, 0, 1);
          pos.lerpVectors(origin, chargePosition, easedWindUp);
        } else if (t < 0.36) {
          const hold = (t - 0.24) / 0.12;
          const pulse = Math.sin(hold * Math.PI * 4) * 0.015;
          pos.copy(chargePosition);
          pos.y += pulse;
        } else if (t < 0.58) {
          const lunge = (t - 0.36) / 0.22;
          const easedLunge = 1 - ((1 - lunge) ** 3);
          pos.lerpVectors(chargePosition, impactPosition, easedLunge);
          pos.y -= Math.sin(lunge * Math.PI) * 0.05;
        } else if (t < 0.76) {
          const rebound = (t - 0.58) / 0.18;
          const recoilDistance = Math.sin(rebound * Math.PI) * 0.18;
          pos.copy(impactPosition).addScaledVector(attackAxis, -recoilDistance);
          pos.y += Math.sin(rebound * Math.PI * 2) * 0.035;
        } else {
          const recover = (t - 0.76) / 0.24;
          const easedRecover = THREE.MathUtils.smootherstep(recover, 0, 1);
          pos.lerpVectors(impactPosition, origin, easedRecover);
        }

        card.position.copy(pos);
        const { y, z } = this.getBoardRotationForCard(card);
        card.rotation.set(CARD_FACE_ROTATION_X, y, z);

        if (!animation.didHit && t >= 0.58 && animation.defenderCard) {
          animation.didHit = true;
          const collisionAxis = attackAxis.lengthSq() > 0 ? attackAxis : new THREE.Vector3(0, 0, 1);
          const currentHealth = Number(animation.defenderCard.userData?.catalogCard?.health);
          const canUpdateHealth = Number.isFinite(currentHealth);
          let defenderDied = false;
          if (Number.isFinite(animation.resolvedDamage) && animation.resolvedDamage > 0) {
            const nextHealth = canUpdateHealth
              ? currentHealth - animation.resolvedDamage
              : null;
            this.spawnDamagePopup({
              amount: animation.resolvedDamage,
              worldPoint: animation.defenderCard.position.clone().add(new THREE.Vector3(0, 0.62, 0)),
              time,
            });
            if (Number.isFinite(nextHealth)) {
              animation.defenderCard.userData.catalogCard.health = nextHealth;
              this.refreshCardFace(animation.defenderCard);
              if (nextHealth < 0) {
                defenderDied = true;
                this.beginCardDeathAnimation(animation.defenderCard, collisionAxis.clone(), time);
              }
            }
          } else if (Number.isFinite(animation.resolvedHealing) && animation.resolvedHealing > 0 && canUpdateHealth) {
            this.spawnBeneficialPopup({
              amount: animation.resolvedHealing,
              worldPoint: animation.defenderCard.position.clone().add(new THREE.Vector3(0, 0.62, 0)),
              time,
            });
            animation.defenderCard.userData.catalogCard.health = currentHealth + animation.resolvedHealing;
            this.refreshCardFace(animation.defenderCard);
          }
          if (Number.isFinite(animation.retaliationDamage) && animation.retaliationDamage > 0) {
            this.spawnDamagePopup({
              amount: animation.retaliationDamage,
              worldPoint: card.position.clone().add(new THREE.Vector3(0, 0.62, 0)),
              time,
            });

            const attackerHealth = Number(card.userData?.catalogCard?.health);
            const retaliationAppliedDamage = Number.isFinite(animation.retaliationAppliedDamage)
              ? Math.max(0, Math.floor(animation.retaliationAppliedDamage))
              : 0;
            if (Number.isFinite(attackerHealth) && retaliationAppliedDamage > 0) {
              const nextAttackerHealth = attackerHealth - retaliationAppliedDamage;
              card.userData.catalogCard.health = nextAttackerHealth;
              this.refreshCardFace(card);
              if (nextAttackerHealth < 0) {
                this.beginCardDeathAnimation(card, collisionAxis.clone().multiplyScalar(-1), time);
              }
            }

            if (Number.isFinite(animation.defenseRemaining) && card?.userData?.cardId) {
              this.setCardStatDisplayOverride(card.userData.cardId, 'defense', Math.max(0, Math.floor(animation.defenseRemaining)));
            }
          }

          if (!defenderDied) this.combatShakeEffects.push({
            card: animation.defenderCard,
            startAtMs: time,
            durationMs: 240,
            basePosition: animation.defenderCard.position.clone(),
            baseRotationZ: animation.defenderCard.rotation.z,
            axis: collisionAxis.clone(),
            amplitude: 0.16,
            swayAmplitude: 0.06,
            rollAmplitude: 0.09,
          });
          this.combatShakeEffects.push({
            card,
            startAtMs: time,
            durationMs: 220,
            basePosition: pos.clone(),
            baseRotationZ: card.rotation.z,
            axis: collisionAxis.clone().multiplyScalar(-1),
            amplitude: 0.09,
            swayAmplitude: 0.04,
            rollAmplitude: 0.05,
          });
        }

        if (t >= 1) {
          card.position.copy(origin);
          card.userData.locked = false;
        } else {
          pending.push(animation);
        }
      }
      this.combatAnimations = pending;
    }

    if (this.deathAnimations.length) {
      const remainingDeaths = [];
      for (const death of this.deathAnimations) {
        const elapsed = time - death.startAtMs;
        const progress = THREE.MathUtils.clamp(elapsed / death.durationMs, 0, 1);
        const eased = THREE.MathUtils.smootherstep(progress, 0, 1);
        death.card.position.copy(death.startPosition)
          .addScaledVector(death.driftAxis, eased * 1.25);
        death.card.position.y = death.startPosition.y + Math.sin(eased * Math.PI) * 0.35 + eased * 0.45;
        death.card.rotation.z = death.startRotationZ + eased * death.rollAmount;

        const opacity = Math.max(0, 1 - eased);
        death.materials.forEach((material) => {
          material.opacity = opacity;
        });

        if (progress >= 1) {
          this.removeCardFromScene(death.card);
        } else {
          remainingDeaths.push(death);
        }
      }
      this.deathAnimations = remainingDeaths;
    }

    if (!this.combatShakeEffects.length) return;
    const remaining = [];
    for (const shake of this.combatShakeEffects) {
      const elapsed = time - shake.startAtMs;
      const progress = THREE.MathUtils.clamp(elapsed / shake.durationMs, 0, 1);
      const envelope = (1 - progress) ** 2;
      const axis = shake.axis || new THREE.Vector3(1, 0, 0);
      const swayAxis = new THREE.Vector3(-axis.z, 0, axis.x);
      const impulse = Math.sin(progress * Math.PI * 3.5) * (shake.amplitude ?? 0.08) * envelope;
      const sway = Math.sin(progress * Math.PI * 7) * (shake.swayAmplitude ?? 0.04) * envelope;
      shake.card.position.set(
        shake.basePosition.x + axis.x * impulse + swayAxis.x * sway,
        shake.basePosition.y + Math.abs(Math.sin(progress * Math.PI * 6)) * 0.03 * envelope,
        shake.basePosition.z + axis.z * impulse + swayAxis.z * sway,
      );
      shake.card.rotation.z = (shake.baseRotationZ ?? 0) + Math.sin(progress * Math.PI * 6) * (shake.rollAmplitude ?? 0.05) * envelope;
      if (progress >= 1) {
        shake.card.position.copy(shake.basePosition);
        shake.card.rotation.z = shake.baseRotationZ ?? 0;
      } else {
        remaining.push(shake);
      }
    }
    this.combatShakeEffects = remaining;
  }

  resolveCombatAnimationSlots(animation) {
    if (!Number.isInteger(animation?.attackerSlotIndex) || !Number.isInteger(animation?.targetSlotIndex)) return null;
    const boardSlotsPerSide = Math.floor(this.boardSlots.length / 2);
    const isOpponentAttack = animation.attackerSide === 'opponent';
    const targetIsAttackerSide = animation.targetSide === 'player';
    const isOpponentTarget = targetIsAttackerSide ? isOpponentAttack : !isOpponentAttack;
    const attackerGlobalSlotIndex = isOpponentAttack
      ? animation.attackerSlotIndex
      : boardSlotsPerSide + animation.attackerSlotIndex;
    const defenderGlobalSlotIndex = isOpponentTarget
      ? animation.targetSlotIndex
      : boardSlotsPerSide + animation.targetSlotIndex;
    const attackerSlot = this.boardSlots[attackerGlobalSlotIndex];
    const defenderSlot = this.boardSlots[defenderGlobalSlotIndex];
    if (!attackerSlot || !defenderSlot) return null;
    return { attackerSlot, defenderSlot };
  }

  beginCardDeathAnimation(card, axis = new THREE.Vector3(0, 0, 1), time = performance.now()) {
    if (!card || card.userData?.isDying) return;
    card.userData.isDying = true;
    card.userData.locked = true;
    const materials = [];
    card.traverse((child) => {
      if (!child?.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        mat.transparent = true;
        mat.depthWrite = false;
        materials.push(mat);
      });
    });
    const driftAxis = axis.lengthSq() > 0 ? axis.clone().normalize() : new THREE.Vector3(0, 0, 1);
    this.combatShakeEffects = this.combatShakeEffects.filter((shake) => shake.card !== card);
    this.deathAnimations.push({
      card,
      startAtMs: time,
      durationMs: 620,
      startPosition: card.position.clone(),
      startRotationZ: card.rotation.z,
      driftAxis,
      rollAmount: (Math.random() * 0.5 + 0.35) * (Math.random() > 0.5 ? 1 : -1),
      materials,
    });
  }

  removeCardFromScene(card) {
    if (!card) return;
    if (card.userData?.zone === CARD_ZONE_TYPES.BOARD && Number.isInteger(card.userData.slotIndex)) {
      const slot = this.boardSlots[card.userData.slotIndex];
      if (slot?.card === card) slot.card = null;
    }
    this.scene.remove(card);
    const cardIndex = this.cards.indexOf(card);
    if (cardIndex >= 0) this.cards.splice(cardIndex, 1);

    if (card?.userData?.zone === CARD_ZONE_TYPES.DISCARD && card?.userData?.cardId) {
      this.discardedCardSnapshotsById.set(card.userData.cardId, {
        id: card.userData.cardId,
        color: card.userData.mesh?.material?.color?.getHex?.() ?? null,
        zone: CARD_ZONE_TYPES.DISCARD,
        slotIndex: null,
        owner: card.userData.owner,
      });
    }

    this.picker.setCards(this.cards);
  }

  getCardsForSync() {
    const inSceneCards = this.cards.map((card) => ({
      id: card.userData.cardId,
      color: card.userData.mesh.material.color.getHex(),
      zone: card.userData.zone,
      slotIndex: card.userData.slotIndex,
      owner: card.userData.owner,
    }));

    const missingDiscardCards = [];
    for (const snapshot of this.discardedCardSnapshotsById.values()) {
      const existsInScene = inSceneCards.some((card) => card.id === snapshot.id);
      if (!existsInScene) missingDiscardCards.push(snapshot);
    }

    return [...inSceneCards, ...missingDiscardCards];
  }

  async handlePointerUp(event) {
    await this.endPointerInteraction(event, { commitDrop: true });
  }

  async handlePointerCancel(event) {
    await this.endPointerInteraction(event, { commitDrop: false });
  }

  applyHandledCardSway(time) {
    const card = this.state.activeCard;
    if (!card || (this.state.mode !== 'preview' && this.state.mode !== 'drag' && this.state.mode !== 'preview-return')) return;

    const { position, rotation, transitionCompleted } = getPreviewPose({
      time,
      mode: this.state.mode,
      previewStartedAt: this.state.previewStartedAt,
      previewOriginPose: this.state.previewOriginPose,
      activePose: this.state.activePose,
      previewTransition: this.state.previewTransition,
    });

    card.position.copy(position);
    card.rotation.copy(rotation);

    if (transitionCompleted) {
      this.state.previewTransition.isActive = false;
      if (this.state.mode === 'preview-return') {
        const pendingAbilitySelection = this.state.pendingAbilitySelection;
        if (!pendingAbilitySelection) {
          this.clearHighlights();
        }
        this.clearActiveCard({
          restore: true,
          preserveSelectedAbility: Boolean(pendingAbilitySelection),
        });
        this.relayoutBoardAndHand();
        if (pendingAbilitySelection) {
          this.highlightValidTargetsForPendingAbility();
          this.setStatus(`Select a ${pendingAbilitySelection.targetType} target for ${card.userData.cardId}.`);
        } else {
          this.setStatus(`Preview closed for ${card.userData.cardId}.`);
        }
      }
    }
  }

  applyPlacedCardAmbientSway(time) {
    const elapsed = time * 0.001;

    for (const slot of this.boardSlots) {
      const card = slot.card;
      if (!card) continue;
      if (card.userData.isAnimating || card.userData.locked) continue;
      if (card === this.state.activeCard && (this.state.mode === 'preview' || this.state.mode === 'drag' || this.state.mode === 'preview-return')) continue;

      const phaseSeed = slot.index * 0.9;
      const swirlX = Math.sin(elapsed * 1.8 + phaseSeed) * PLACED_CARD_SWIRL_AMPLITUDE;
      const swirlZ = Math.cos(elapsed * 1.45 + phaseSeed * 1.2) * PLACED_CARD_SWIRL_AMPLITUDE * 0.55;
      const ambientLift = Math.sin(elapsed * 2.15 + phaseSeed * 0.7) * PLACED_CARD_VERTICAL_SWAY_AMPLITUDE;
      const rotationalFlareY = Math.sin(elapsed * 1.7 + phaseSeed) * PLACED_CARD_ROTATIONAL_FLARE_AMPLITUDE;
      const rotationalFlareZ = Math.cos(elapsed * 1.95 + phaseSeed * 1.3) * PLACED_CARD_ROTATIONAL_FLARE_AMPLITUDE * 0.4;

      card.position.set(slot.x + swirlX, ambientLift, slot.z + swirlZ);
      const boardRotation = this.getBoardRotationForSlot(slot);
      card.rotation.set(
        CARD_FACE_ROTATION_X,
        boardRotation.y + rotationalFlareY,
        boardRotation.z + rotationalFlareZ,
      );
    }
  }

  queueCardAnimationsFromHooks(context = {}) {
    if (!this.cardAnimationHooks.length) return;

    const now = performance.now();
    const animationContext = {
      ...context,
      template: this.template,
      deckSlots: this.deckSlots,
      boardSlots: this.boardSlots,
    };

    for (const card of this.cards) {
      const targetPosition = card.position.clone();
      const targetRotation = card.rotation.clone();

      for (const hook of this.cardAnimationHooks) {
        const config = hook(card, animationContext);
        if (!config) continue;

        const fromPosition = config.fromPosition
          ? new THREE.Vector3(config.fromPosition.x, config.fromPosition.y, config.fromPosition.z)
          : targetPosition.clone();
        const fromRotation = config.fromRotation
          ? new THREE.Euler(config.fromRotation.x, config.fromRotation.y, config.fromRotation.z)
          : targetRotation.clone();

        card.userData.locked = true;
        card.userData.isAnimating = true;
        card.position.copy(fromPosition);
        card.rotation.copy(fromRotation);

        this.cardAnimations.push({
          card,
          targetPosition,
          targetRotation,
          fromPosition,
          fromRotation,
          startAtMs: now + (config.delayMs ?? 0),
          durationMs: Math.max(120, config.durationMs ?? 700),
          arcHeight: config.arcHeight ?? 0.65,
          swirlAmplitude: config.swirlAmplitude ?? 0.08,
        });
        break;
      }
    }
  }

  applyCardAnimations(time) {
    if (!this.cardAnimations.length) return;

    const nextAnimations = [];
    for (const animation of this.cardAnimations) {
      const { card, targetPosition, targetRotation, fromPosition, fromRotation } = animation;
      const elapsed = time - animation.startAtMs;
      if (elapsed < 0) {
        nextAnimations.push(animation);
        continue;
      }

      const rawProgress = THREE.MathUtils.clamp(elapsed / animation.durationMs, 0, 1);
      const eased = 1 - ((1 - rawProgress) ** 3);

      const position = fromPosition.clone().lerp(targetPosition, eased);
      const arc = Math.sin(rawProgress * Math.PI) * animation.arcHeight;
      const settleEnvelope = (1 - rawProgress) ** 2;
      const swirl = Math.sin(rawProgress * Math.PI * 2) * animation.swirlAmplitude * settleEnvelope;
      const ambientLift = Math.sin((time * 0.001) * CARD_ANIMATION_MAGIC_SWAY_SPEED + animation.startAtMs * 0.001)
        * 0.05
        * settleEnvelope;
      position.y += arc + ambientLift;
      position.x += swirl;

      card.position.copy(position);
      card.rotation.set(
        THREE.MathUtils.lerp(fromRotation.x, targetRotation.x, eased),
        THREE.MathUtils.lerp(fromRotation.y, targetRotation.y, eased)
          + Math.cos(rawProgress * Math.PI * 2) * animation.swirlAmplitude * 0.7 * settleEnvelope,
        THREE.MathUtils.lerp(fromRotation.z, targetRotation.z, eased)
          + Math.sin(rawProgress * Math.PI * 2) * animation.swirlAmplitude * settleEnvelope,
      );

      if (rawProgress >= 1) {
        card.position.copy(targetPosition);
        card.rotation.copy(targetRotation);
        card.userData.isAnimating = false;
        card.userData.locked = false;
      } else {
        nextAnimations.push(animation);
      }
    }

    this.cardAnimations = nextAnimations;
  }

  animate(time) {
    this.applyCardAnimations(time);
    this.applyCombatAnimations(time);
    this.applyDamagePopups(time);
    this.applyHandledCardSway(time);
    this.applyPlacedCardAmbientSway(time);
    this.positionSpellRollerPanel();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  destroy() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.canvasContainer.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvasContainer.removeEventListener('pointermove', this.handlePointerMove);
    this.canvasContainer.removeEventListener('pointerup', this.handlePointerUp);
    this.canvasContainer.removeEventListener('pointercancel', this.handlePointerCancel);
    window.removeEventListener('resize', this.updateSize);
    this.resetBtn?.removeEventListener('click', this.resetDemo);
    this.clearSpellRollerPanel();
    this.state.spellRollerLayer?.remove();
    this.state.spellRollerLayer = null;
    this.damagePopups.forEach((popup) => popup.node?.remove());
    this.damagePopups = [];
    this.damagePopupLayer?.remove();
    this.damagePopupLayer = null;
    this.cardBackTexture?.dispose?.();
    this.renderer.dispose();
  }
}
