import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from '../render/CardMeshFactory.js';
import { createCardLabelTexture } from '../render/cardLabelTexture.js';
import { CardPicker } from '../render/CardPicker.js';
import { CardGameHttpClient } from '../net/httpClient.js';
import { SINGLE_CARD_TEMPLATE } from '../templates/singleCardTemplate.js';
import { CARD_ZONE_TYPES, isKnownZone, validateZoneTemplate } from './zoneFramework.js';
import { DEFAULT_PREVIEW_TUNING, sanitizePreviewTuning } from './previewTuning.js';
import { PREVIEW_HOLD_DELAY_MS, PREVIEW_TRANSITION_IN_MS, PREVIEW_BASE_POSITION, beginPreviewTransition, beginPreviewReturnTransition, getPreviewPose } from './previewMotion.js';

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
    this.boardSlots = [];
    this.deckSlots = [];
    this.cardAnimations = [];
    this.combatAnimations = [];
    this.combatShakeEffects = [];
    this.pointerNdc = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.planePoint = new THREE.Vector3();

    this.state = {
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
    };

    this.#buildBaseScene();
    this.picker = new CardPicker({ camera: this.camera, domElement: canvas, cards: this.cards });

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.updateSize = this.updateSize.bind(this);
    this.animate = this.animate.bind(this);
    this.resetDemo = this.resetDemo.bind(this);
    this.handleWebglContextLost = this.handleWebglContextLost.bind(this);
    this.handleWebglContextRestored = this.handleWebglContextRestored.bind(this);

    this.isRendererContextLost = false;

    this.canvasContainer.addEventListener('pointerdown', this.handlePointerDown);
    this.canvasContainer.addEventListener('pointermove', this.handlePointerMove);
    this.canvasContainer.addEventListener('pointerup', this.handlePointerUp);
    this.canvasContainer.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('webglcontextlost', this.handleWebglContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleWebglContextRestored, false);
    window.addEventListener('resize', this.updateSize);
    this.resetBtn?.addEventListener('click', this.resetDemo);

    this.updateSize();
    this.resetDemo();
    this.animationFrame = requestAnimationFrame(this.animate);
    this.loadCardState();
  }

  #buildBaseScene() {
    const hemiLight = new THREE.HemisphereLight(0xeaf2ff, 0x202938, 0.9);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(4, 8, 6);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

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
    for (const card of this.cards) card.userData.mesh.material.emissive.setHex(0x000000);
    this.clearAttackTargetHover();
  }

  clearAttackTargetHover() {
    for (const card of this.cards) {
      if (!card.userData.isAttackHover) continue;
      card.scale.setScalar(1);
      card.userData.isAttackHover = false;
    }
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

  setPreviewTuning(nextPreviewTuning = {}) {
    this.previewTuning = sanitizePreviewTuning(nextPreviewTuning);
    if ((this.state.mode === 'preview' || this.state.mode === 'preview-return') && this.state.activeCard) {
      this.setActiveCardPose(
        new THREE.Vector3(
          PREVIEW_BASE_POSITION.x,
          PREVIEW_BASE_POSITION.y,
          PREVIEW_BASE_POSITION.z + this.previewTuning.cameraDistanceOffset,
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
    card.userData.mesh.material.emissive.setHex(0x111111);
    card.userData.tiltPivot.rotation.set(0, 0, 0);
    if (mode === 'preview') {
      this.state.previewOriginPose.position.copy(card.position);
      this.state.previewOriginPose.rotation.copy(card.rotation);
      beginPreviewTransition(this.state, this.state.previewStartedAt);
      this.setActiveCardPose(
        new THREE.Vector3(
          PREVIEW_BASE_POSITION.x,
          PREVIEW_BASE_POSITION.y,
          PREVIEW_BASE_POSITION.z + this.previewTuning.cameraDistanceOffset,
        ),
        this.previewTuning.rotationX,
        0,
        0,
      );
    }
    else this.setActiveCardPose(card.position, CARD_FACE_ROTATION_X + 0.24, 0, 0);
    this.setStatus(mode === 'drag'
      ? `Dragging ${card.userData.cardId}. Release to commit to a board slot.`
      : `Previewing ${card.userData.cardId}. Move to drag or release to return.`);
  }

  clearActiveCard({ restore = true } = {}) {
    if (!this.state.activeCard) return;
    const card = this.state.activeCard;
    card.renderOrder = 0;
    card.userData.mesh.material.emissive.setHex(0x000000);
    card.userData.tiltPivot.rotation.set(0, 0, 0);
    if (restore) this.relayoutBoardAndHand();
    this.state.activeCard = null;
    this.state.mode = 'idle';
    this.state.dropSlotIndex = null;
    this.state.previewTransition.isActive = false;
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
    if (card.userData.zone === CARD_ZONE_TYPES.HAND && card.userData.owner === this.template.playerSide) return true;
    if (this.canCardAttack(card)) return true;
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

  resetDemo() {
    this.clearHighlights();
    this.clearActiveCard({ restore: false });
    window.clearTimeout(this.state.holdTimer);
    this.state.holdTimer = 0;
    this.state.activePointerId = null;
    this.boardSlots.forEach((slot) => { slot.card = null; });
    this.cardAnimations.length = 0;

    for (const card of this.cards) this.scene.remove(card);
    this.cards.length = 0;

    for (const cfg of this.template.initialCards) {
      const faceTexture = cfg.catalogCard
        ? createCardLabelTexture(cfg.catalogCard, { backgroundImagePath: '/public/assets/CardFront2.png' })
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
      card.userData.targetSlotIndex = Number.isInteger(cfg.targetSlotIndex) ? cfg.targetSlotIndex : null;
      card.userData.catalogCard = cfg.catalogCard ?? null;
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
    this.queueCardAnimationsFromHooks({ reason: 'reset' });
    this.picker.setCards(this.cards);
    this.setStatus('Demo reset. Zone framework enabled with mirrored player/opponent zones; board remains capped at 3 slots per side and 1 deck slot per side.');
  }

  async handlePointerDown(event) {
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

    const card = this.picker.pick(event);
    if (!card) {
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

    this.state.pendingCard = card;
    this.state.pendingCardCanDrag = this.canCardDrag(card);
    this.state.pendingCardDidPickup = false;
    this.clearHighlights();
    this.state.dragOrigin = { zone: card.userData.zone, slotIndex: card.userData.slotIndex };

    if (this.canCardAttack(card)) {
      this.state.dropTargetSlotIndex = card.userData.targetSlotIndex;
    } else if (this.state.pendingCardCanDrag) {
      if (card.userData.zone === CARD_ZONE_TYPES.BOARD && Number.isInteger(card.userData.slotIndex)) this.boardSlots[card.userData.slotIndex].card = null;
      await this.sendCardEvent(card.userData.cardId, 'pickup', { zone: this.state.dragOrigin.zone });
      this.state.pendingCardDidPickup = true;
    }

    this.state.holdTimer = window.setTimeout(() => {
      if (this.state.activePointerId !== event.pointerId || this.state.mode !== 'idle') return;
      this.setCardAsActive(card, 'preview');
    }, PREVIEW_HOLD_DELAY_MS);
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

    if (this.state.mode === 'preview' && this.state.pendingCardCanDrag && distance > DRAG_START_DISTANCE_PX && this.state.activeCard) this.beginDrag(this.state.activeCard);
    if (this.state.mode === 'drag' && this.state.activeCard) {
      event.preventDefault();
      if (this.canCardAttack(this.state.activeCard)) this.updateAttackTargetPoseFromPointer(event);
      else this.updateDragPoseFromPointer(event);
    }
  }

  async endPointerInteraction(event, { commitDrop = true } = {}) {
    if (this.state.activePointerId !== event.pointerId) return;
    if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
    window.clearTimeout(this.state.holdTimer);
    this.state.holdTimer = 0;

    const card = this.state.activeCard;
    const prevOrigin = this.state.dragOrigin;

    if (card && commitDrop && this.state.mode === 'drag' && this.canCardAttack(card) && this.state.dropTargetSlotIndex != null) {
      card.userData.attackCommitted = true;
      card.userData.targetSlotIndex = this.state.dropTargetSlotIndex;
      await this.notifyCardStateCommitted(card);
      this.setStatus(`Attack queued: ${card.userData.cardId} -> enemy slot ${this.state.dropTargetSlotIndex + 1}.`);
    } else if (card && commitDrop && this.state.mode === 'drag' && this.state.dropSlotIndex != null) {
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
    return this.cards
      .filter((card) => card.userData.owner === this.template.playerSide && card.userData.zone === CARD_ZONE_TYPES.BOARD)
      .filter((card) => card.userData.attackCommitted === true && Number.isInteger(card.userData.slotIndex) && Number.isInteger(card.userData.targetSlotIndex))
      .map((card) => ({
        attackerSlotIndex: card.userData.slotIndex - boardSlotsPerSide,
        targetSlotIndex: card.userData.targetSlotIndex,
      }));
  }

  playCommitPhaseAnimations(attackPlan = [], { onDone, interAttackDelayMs = 720 } = {}) {
    if (!Array.isArray(attackPlan) || !attackPlan.length) {
      onDone?.();
      return;
    }

    const now = performance.now();
    const boardSlotsPerSide = Math.floor(this.boardSlots.length / 2);
    const resolveAttackSlots = (step) => {
      const preferredSide = step?.attackerSide === 'opponent' ? 'opponent' : 'player';
      const orderedSides = preferredSide === 'opponent' ? ['opponent', 'player'] : ['player', 'opponent'];

      for (const side of orderedSides) {
        const isOpponentAttack = side === 'opponent';
        const attackerGlobalSlotIndex = isOpponentAttack
          ? step.attackerSlotIndex
          : boardSlotsPerSide + step.attackerSlotIndex;
        const defenderGlobalSlotIndex = isOpponentAttack
          ? boardSlotsPerSide + step.targetSlotIndex
          : step.targetSlotIndex;
        const attackerSlot = this.boardSlots[attackerGlobalSlotIndex];
        const defenderSlot = this.boardSlots[defenderGlobalSlotIndex];

        if (!attackerSlot?.card || !defenderSlot) continue;
        return { attackerSlot, defenderSlot };
      }

      return null;
    };

    attackPlan.forEach((step, index) => {
      const resolvedSlots = resolveAttackSlots(step);
      if (!resolvedSlots) return;

      const { attackerSlot, defenderSlot } = resolvedSlots;
      this.combatAnimations.push({
        attackerCard: attackerSlot.card,
        originPosition: new THREE.Vector3(attackerSlot.x, 0, attackerSlot.z),
        defenderPosition: new THREE.Vector3(defenderSlot.x, 0, defenderSlot.z),
        startAtMs: now + index * interAttackDelayMs,
        durationMs: 760,
        defenderCard: defenderSlot.card,
        didHit: false,
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

        const t = THREE.MathUtils.clamp(elapsed / animation.durationMs, 0, 1);
        const card = animation.attackerCard;
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
          this.combatShakeEffects.push({
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
        this.clearHighlights();
        this.clearActiveCard({ restore: true });
        this.relayoutBoardAndHand();
        this.setStatus(`Preview closed for ${card.userData.cardId}.`);
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
    if (this.isRendererContextLost) {
      this.animationFrame = requestAnimationFrame(this.animate);
      return;
    }

    this.applyCardAnimations(time);
    this.applyCombatAnimations(time);
    this.applyHandledCardSway(time);
    this.applyPlacedCardAmbientSway(time);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  destroy() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.canvasContainer.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvasContainer.removeEventListener('pointermove', this.handlePointerMove);
    this.canvasContainer.removeEventListener('pointerup', this.handlePointerUp);
    this.canvasContainer.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('webglcontextlost', this.handleWebglContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.handleWebglContextRestored, false);
    window.removeEventListener('resize', this.updateSize);
    this.resetBtn?.removeEventListener('click', this.resetDemo);
    this.cardBackTexture?.dispose?.();
    this.renderer.dispose();
  }

  handleWebglContextLost(event) {
    event.preventDefault();
    this.isRendererContextLost = true;
    this.setStatus('Rendering context was lost. Attempting to recover…');
  }

  handleWebglContextRestored() {
    this.isRendererContextLost = false;
    this.renderer.resetState();
    this.updateSize();
    this.setStatus('Rendering context restored.');
  }
}
