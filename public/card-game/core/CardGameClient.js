import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from '../render/CardMeshFactory.js';
import { CardPicker } from '../render/CardPicker.js';
import { CardGameHttpClient } from '../net/httpClient.js';
import { SINGLE_CARD_TEMPLATE } from '../templates/singleCardTemplate.js';
import { CARD_ZONE_TYPES, isKnownZone, validateZoneTemplate } from './zoneFramework.js';

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

const PREVIEW_HOLD_DELAY_MS = 230;
const DRAG_START_DISTANCE_PX = 10;
const CARD_FACE_ROTATION_X = -Math.PI / 2;
const HAND_CARD_BASE_Y = 0.1;
const HAND_CARD_ARC_LIFT = 0.06;
const HAND_CARD_FAN_ROTATION_Z = 0.08;
const CARD_ANIMATION_MAGIC_SWAY_SPEED = 7.2;

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
    this.onCardStateCommitted = options.onCardStateCommitted;
    this.cardAnimationHooks = Array.isArray(options.cardAnimationHooks) ? options.cardAnimationHooks : [];
    this.net = new CardGameHttpClient(options.net || {});

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101522);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 8.2, 4.8);
    this.camera.lookAt(0, 0, 0.4);

    this.cards = [];
    this.boardSlots = [];
    this.deckSlots = [];
    this.cardAnimations = [];
    this.pointerNdc = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.planePoint = new THREE.Vector3();

    this.state = {
      activePointerId: null,
      pendingCard: null,
      activeCard: null,
      mode: 'idle',
      holdTimer: 0,
      lastPointer: { x: 0, y: 0 },
      pressPointer: { x: 0, y: 0 },
      previewStartedAt: 0,
      dragOrigin: null,
      dropSlotIndex: null,
      activePose: {
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(CARD_FACE_ROTATION_X, 0, 0),
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
    const hemiLight = new THREE.HemisphereLight(0xeaf2ff, 0x202938, 0.9);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(4, 8, 6);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x1c2434, roughness: 0.95, metalness: 0.03 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.72;
    table.receiveShadow = true;
    this.scene.add(table);

    const boardArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.3, 5.8),
      new THREE.MeshStandardMaterial({ color: 0x243146, roughness: 0.85, metalness: 0.06, transparent: true, opacity: 0.45 }),
    );
    boardArea.position.set(0, -0.71, 0.15);
    boardArea.rotation.x = -Math.PI / 2;
    this.scene.add(boardArea);

    const playerTerritoryArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.3, 2.9),
      new THREE.MeshStandardMaterial({ color: 0x2f4c7f, roughness: 0.86, metalness: 0.08, transparent: true, opacity: 0.38 }),
    );
    playerTerritoryArea.position.set(0, -0.708, 1.6);
    playerTerritoryArea.rotation.x = -Math.PI / 2;
    this.scene.add(playerTerritoryArea);

    const opponentTerritoryArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.3, 2.9),
      new THREE.MeshStandardMaterial({ color: 0x5a2f4f, roughness: 0.86, metalness: 0.08, transparent: true, opacity: 0.26 }),
    );
    opponentTerritoryArea.position.set(0, -0.708, -1.3);
    opponentTerritoryArea.rotation.x = -Math.PI / 2;
    this.scene.add(opponentTerritoryArea);

    this.handArea = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 2),
      new THREE.MeshStandardMaterial({ color: 0x1f2a3f, roughness: 0.9, metalness: 0.04, transparent: true, opacity: 0.55 }),
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
      const zoneColor = slot.side === this.template.playerSide ? 0x5f83c7 : 0xa06085;
      const slotMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 2.65), new THREE.MeshStandardMaterial({ color: zoneColor, transparent: true, opacity: 0.26, roughness: 0.86, metalness: 0.07 }));
      slotMesh.rotation.x = -Math.PI / 2;
      slotMesh.position.set(slot.x, -0.694, slot.z);
      this.scene.add(slotMesh);

      const deck = CardMeshFactory.createCard({
        id: `${slot.side}-deck`, width: 1.8, height: 2.5, thickness: 0.42, cornerRadius: 0.15,
        color: slot.side === this.template.playerSide ? 0x2e436a : 0x5d3653,
      });
      deck.position.set(slot.x, 0.17, slot.z);
      deck.rotation.set(-Math.PI / 2, 0, 0);
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

  relayoutBoardAndHand() {
    this.boardSlots.forEach((slot) => {
      if (!slot.card) return;
      const card = slot.card;
      if (card.userData.isAnimating) return;
      if (card === this.state.activeCard && (this.state.mode === 'drag' || this.state.mode === 'preview')) return;
      card.userData.zone = CARD_ZONE_TYPES.BOARD;
      card.userData.slotIndex = slot.index;
      card.position.set(slot.x, 0, slot.z);
      card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);
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

  setCardAsActive(card, mode) {
    this.state.activeCard = card;
    this.state.mode = mode;
    this.state.previewStartedAt = performance.now();
    card.renderOrder = 10;
    card.userData.mesh.material.emissive.setHex(0x111111);
    card.userData.tiltPivot.rotation.set(0, 0, 0);
    if (mode === 'preview') this.setActiveCardPose(new THREE.Vector3(0, 1.52, 1.08), -0.68, 0, 0);
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

  beginDrag(card) {
    if (!card) return;
    if (this.state.mode === 'idle') this.setCardAsActive(card, 'drag');
    else {
      this.state.mode = 'drag';
      this.setStatus(`Dragging ${card.userData.cardId}. Release to commit to a board slot.`);
    }
    window.clearTimeout(this.state.holdTimer);
    this.state.holdTimer = 0;
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
      const card = CardMeshFactory.createCard({ id: cfg.id, width: 1.8, height: 2.5, thickness: 0.08, cornerRadius: 0.15, color: cfg.color });
      card.userData.zone = isKnownZone(cfg.zone, this.zoneFramework) ? cfg.zone : CARD_ZONE_TYPES.HAND;
      card.userData.slotIndex = cfg.slotIndex ?? null;
      card.userData.owner = cfg.owner ?? this.template.playerSide;
      card.userData.dealOrder = cfg.dealOrder ?? null;
      card.userData.locked = false;
      card.userData.isAnimating = false;
      card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);
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
    if (this.state.activePointerId != null) return;
    this.canvasContainer.setPointerCapture(event.pointerId);
    this.state.activePointerId = event.pointerId;
    this.state.pressPointer.x = event.clientX;
    this.state.pressPointer.y = event.clientY;
    this.state.lastPointer.x = event.clientX;
    this.state.lastPointer.y = event.clientY;
    this.state.dropSlotIndex = null;

    const card = this.picker.pick(event);
    if (!card) {
      this.state.activePointerId = null;
      this.state.pendingCard = null;
      if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
      this.setStatus('No card selected.');
      return;
    }

    if (card.userData.locked) {
      this.state.activePointerId = null;
      this.state.pendingCard = null;
      if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
      this.setStatus(`${card.userData.cardId} is still animating. Try again in a moment.`);
      return;
    }

    if (card.userData.zone === CARD_ZONE_TYPES.BOARD && card.userData.owner !== this.template.playerSide) {
      this.state.activePointerId = null;
      this.state.pendingCard = null;
      if (this.canvasContainer.hasPointerCapture(event.pointerId)) this.canvasContainer.releasePointerCapture(event.pointerId);
      this.setStatus('Opponent cards are locked to their side. Drag one of your cards instead.');
      return;
    }

    this.state.pendingCard = card;
    this.clearHighlights();
    this.state.dragOrigin = { zone: card.userData.zone, slotIndex: card.userData.slotIndex };

    if (card.userData.zone === CARD_ZONE_TYPES.BOARD && Number.isInteger(card.userData.slotIndex)) this.boardSlots[card.userData.slotIndex].card = null;
    await this.sendCardEvent(card.userData.cardId, 'pickup', { zone: this.state.dragOrigin.zone });

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

    if (this.state.mode === 'idle' && card && distance > DRAG_START_DISTANCE_PX) {
      this.setCardAsActive(card, 'drag');
      this.beginDrag(card);
    }

    if (this.state.mode === 'preview' && distance > DRAG_START_DISTANCE_PX && this.state.activeCard) this.beginDrag(this.state.activeCard);
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

    if (card && commitDrop && this.state.mode === 'drag' && this.state.dropSlotIndex != null) {
      const slot = this.boardSlots[this.state.dropSlotIndex];
      slot.card = card;
      card.userData.zone = CARD_ZONE_TYPES.BOARD;
      card.userData.slotIndex = slot.index;
      card.position.set(slot.x, 0, slot.z);
      card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);
      await this.sendCardEvent(card.userData.cardId, 'putdown', { zone: CARD_ZONE_TYPES.BOARD, slotIndex: slot.index });
      card.userData.owner = this.template.playerSide;
      await this.notifyCardStateCommitted(card);
      this.setStatus(`Placed ${card.userData.cardId} into board slot ${slot.index + 1}.`);
    } else if (card) {
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
      card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);
      await this.sendCardEvent(card.userData.cardId, 'putdown', { zone: card.userData.zone, slotIndex: card.userData.slotIndex });
      await this.notifyCardStateCommitted(card);
      this.setStatus(this.state.mode === 'preview' ? `Preview closed for ${card.userData.cardId}.` : `Returned ${card.userData.cardId} to ${card.userData.zone}.`);
    }

    this.clearHighlights();
    this.clearActiveCard({ restore: true });
    this.relayoutBoardAndHand();

    this.state.activePointerId = null;
    this.state.pendingCard = null;
    this.state.dragOrigin = null;
  }

  async handlePointerUp(event) {
    await this.endPointerInteraction(event, { commitDrop: true });
  }

  async handlePointerCancel(event) {
    await this.endPointerInteraction(event, { commitDrop: false });
  }

  applyHandledCardSway(time) {
    const card = this.state.activeCard;
    if (!card || (this.state.mode !== 'preview' && this.state.mode !== 'drag')) return;

    const elapsed = (time - this.state.previewStartedAt) * 0.001;
    const basePos = this.state.activePose.position;
    const baseRot = this.state.activePose.rotation;

    const swayPosition = this.state.mode === 'preview'
      ? new THREE.Vector3(Math.sin(elapsed * 1.8) * 0.22, Math.sin(elapsed * 2.4) * 0.07, Math.cos(elapsed * 1.6) * 0.16)
      : new THREE.Vector3(Math.sin(elapsed * 3.6) * 0.05, Math.sin(elapsed * 5.2) * 0.03, Math.cos(elapsed * 4.1) * 0.04);

    card.position.set(basePos.x + swayPosition.x, basePos.y + swayPosition.y, basePos.z + swayPosition.z);

    const swayAmount = this.state.mode === 'preview' ? 1 : 0.8;
    card.rotation.set(
      baseRot.x + Math.sin(elapsed * 2.2) * 0.04 * swayAmount,
      baseRot.y + Math.sin(elapsed * 1.5) * 0.18 * swayAmount,
      baseRot.z + Math.cos(elapsed * 1.8) * 0.03 * swayAmount,
    );
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
      const swirl = Math.sin(rawProgress * Math.PI * 2.4) * animation.swirlAmplitude;
      position.y += arc + Math.sin((time * 0.001) * CARD_ANIMATION_MAGIC_SWAY_SPEED + animation.startAtMs * 0.001) * 0.05;
      position.x += swirl;

      card.position.copy(position);
      card.rotation.set(
        THREE.MathUtils.lerp(fromRotation.x, targetRotation.x, eased),
        THREE.MathUtils.lerp(fromRotation.y, targetRotation.y, eased) + Math.cos(rawProgress * Math.PI * 2) * animation.swirlAmplitude * 0.7,
        THREE.MathUtils.lerp(fromRotation.z, targetRotation.z, eased) + Math.sin(rawProgress * Math.PI * 1.5) * animation.swirlAmplitude,
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
    this.applyHandledCardSway(time);
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
    this.renderer.dispose();
  }
}
