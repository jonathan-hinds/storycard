import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from '/public/card-game/render/CardMeshFactory.js';

const GRID_COLUMNS = 5;
const CARD_WIDTH = 1.8;
const CARD_HEIGHT = 2.5;
const CARD_THICKNESS = 0.08;
const GRID_X_SPACING = CARD_WIDTH;
const GRID_Y_SPACING = CARD_HEIGHT;
const GRID_LEFT_PADDING = 0;
const GRID_TOP_PADDING = 0;
const GRID_BOTTOM_PADDING = 0;
const ROW_HEIGHT_PX = 280;
const GRID_VERTICAL_PADDING_PX = 0;
const TARGET_VISIBLE_ROWS = 2;
const CAMERA_VERTICAL_OVERSCAN = 0;
const HOLD_DELAY_MS = 250;
const DRAG_START_DISTANCE_PX = 10;
const HOLD_SCALE = 1.52;
const HOLD_Z_OFFSET = 2.2;
const DRAG_Z_OFFSET = 2.4;

const TYPE_COLORS = {
  assassin: 0x7f5af0,
  tank: 0x2cb67d,
  mage: 0xef4565,
  support: 0xf4b400,
  ranger: 0x3da9fc,
};

function colorForType(type) {
  if (!type) return 0x4f8ef7;
  return TYPE_COLORS[String(type).toLowerCase()] ?? 0x4f8ef7;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createCardLabelTexture(card) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, '#1f2a44');
  gradient.addColorStop(1, '#0d1321');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let index = 0; index < 14; index += 1) {
    drawRoundedRect(ctx, 42 + index * 8, 42 + index * 8, 940 - index * 16, 940 - index * 16, 28);
    ctx.fill();
  }

  ctx.fillStyle = '#dfe8ff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 74px Inter, system-ui, sans-serif';
  ctx.fillText(card.name || 'Unnamed Card', 512, 200, 820);

  ctx.fillStyle = '#9ab0d8';
  ctx.font = '600 40px Inter, system-ui, sans-serif';
  ctx.fillText(card.type || 'unknown', 512, 268, 720);

  const stats = [
    ['DMG', card.damage],
    ['HP', card.health],
    ['SPD', card.speed],
  ];

  stats.forEach(([label, value], index) => {
    const width = 250;
    const height = 250;
    const gap = 34;
    const left = 120 + (width + gap) * index;
    const top = 632;

    ctx.fillStyle = 'rgba(18, 24, 40, 0.82)';
    drawRoundedRect(ctx, left, top, width, height, 24);
    ctx.fill();

    ctx.fillStyle = '#8ea4cf';
    ctx.font = '600 36px Inter, system-ui, sans-serif';
    ctx.fillText(label, left + width / 2, top + 88);

    ctx.fillStyle = '#f1f5ff';
    ctx.font = '700 78px Inter, system-ui, sans-serif';
    ctx.fillText(String(value ?? '-'), left + width / 2, top + 188);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

export class CardLibraryScene {
  constructor({ canvas, scrollContainer }) {
    this.canvas = canvas;
    this.scrollContainer = scrollContainer;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1320);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);

    this.clock = new THREE.Clock();
    this.cards = [];
    this.cardRoots = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerCard = null;
    this.activePointerId = null;
    this.draggingCard = null;
    this.dragPosition = new THREE.Vector3();
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.dragPlaneHit = new THREE.Vector3();
    this.pressPointer = { x: 0, y: 0 };
    this.holdTimeoutId = null;
    this.heldCard = null;
    this.heldStartTime = 0;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onResize = this.onResize.bind(this);

    const hemiLight = new THREE.HemisphereLight(0xdce8ff, 0x1a1f2c, 1.1);
    hemiLight.position.set(0, 18, 4);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(4, 12, 9);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x85aaff, 0.5);
    fillLight.position.set(-5, -6, 4);
    this.scene.add(fillLight);

    this.scrollContainer.addEventListener('pointerdown', this.onPointerDown);
    this.scrollContainer.addEventListener('pointermove', this.onPointerMove);
    this.scrollContainer.addEventListener('pointerup', this.onPointerUp);
    this.scrollContainer.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onResize);

    this.onResize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.scrollContainer.removeEventListener('pointerdown', this.onPointerDown);
    this.scrollContainer.removeEventListener('pointermove', this.onPointerMove);
    this.scrollContainer.removeEventListener('pointerup', this.onPointerUp);
    this.scrollContainer.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    this.clearCards();
    this.renderer.dispose();
  }

  clearCards() {
    this.cardRoots.forEach((root) => {
      const mesh = root.userData.mesh;
      if (mesh?.material?.dispose) mesh.material.dispose();
      if (mesh?.geometry?.dispose) mesh.geometry.dispose();

      const face = root.userData.face;
      if (face) {
        face.material.map?.dispose?.();
        face.material.dispose();
        face.geometry.dispose();
      }

      this.scene.remove(root);
    });

    this.cards.length = 0;
    this.cardRoots.length = 0;
    this.pointerCard = null;
    this.heldCard = null;
    this.draggingCard = null;
  }

  setCards(cards) {
    this.clearCards();
    this.cards = cards.slice();

    this.cards.forEach((card, index) => {
      const row = Math.floor(index / GRID_COLUMNS);
      const column = index % GRID_COLUMNS;
      const basePosition = new THREE.Vector3(
        GRID_LEFT_PADDING + CARD_WIDTH * 0.5 + column * GRID_X_SPACING,
        -(GRID_TOP_PADDING + CARD_HEIGHT * 0.5 + row * GRID_Y_SPACING),
        0,
      );

      const root = CardMeshFactory.createCard({
        id: card.id,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        thickness: CARD_THICKNESS,
        cornerRadius: 0.15,
        color: colorForType(card.type),
      });

      const texture = createCardLabelTexture(card);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(CARD_WIDTH * 0.92, CARD_HEIGHT * 0.92),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75, metalness: 0.04 }),
      );
      face.position.set(0, 0, CARD_THICKNESS * 0.51);
      root.userData.tiltPivot.add(face);
      root.userData.face = face;

      root.userData.basePosition = basePosition;
      root.userData.baseScale = 1;
      root.userData.phase = index * 0.63;
      root.userData.holdProgress = 0;
      root.userData.targetHoldProgress = 0;
      root.userData.catalogCard = card;

      root.position.copy(basePosition);
      root.rotation.set(-0.08, 0, 0);

      this.scene.add(root);
      this.cardRoots.push(root);
    });

    this.onResize();
  }

  setPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  pickCard(event) {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.cardRoots, true);
    const hit = hits.find((candidate) => candidate.object?.userData?.cardRoot || candidate.object.parent?.parent?.parent);
    if (!hit) return null;

    let node = hit.object;
    while (node && !this.cardRoots.includes(node)) node = node.parent;
    return node;
  }

  onPointerDown(event) {
    if (event.button !== 0 || this.activePointerId != null) return;
    this.activePointerId = event.pointerId;
    this.pressPointer.x = event.clientX;
    this.pressPointer.y = event.clientY;
    this.scrollContainer.setPointerCapture(event.pointerId);

    const target = this.pickCard(event);
    this.pointerCard = target;
    if (!target) return;

    this.holdTimeoutId = window.setTimeout(() => {
      this.heldCard = target;
      this.heldStartTime = performance.now();
      target.userData.targetHoldProgress = 1;
    }, HOLD_DELAY_MS);
  }

  getPointerDistanceFromPress(event) {
    return Math.hypot(event.clientX - this.pressPointer.x, event.clientY - this.pressPointer.y);
  }

  clearPendingHold() {
    if (this.holdTimeoutId) {
      clearTimeout(this.holdTimeoutId);
      this.holdTimeoutId = null;
    }
  }

  beginDrag(card) {
    this.clearPendingHold();
    if (this.heldCard === card) {
      this.heldCard.userData.targetHoldProgress = 0;
      this.heldCard = null;
    }
    this.draggingCard = card;
    this.scrollContainer.classList.add('cards-list--dragging');
  }

  updateDragFromPointer(event) {
    if (!this.draggingCard) return;
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPlaneHit)) return;
    this.dragPosition.copy(this.dragPlaneHit);
  }

  endDrag() {
    if (!this.draggingCard) return;
    this.draggingCard.userData.targetHoldProgress = 0;
    this.draggingCard = null;
    this.scrollContainer.classList.remove('cards-list--dragging');
  }

  onPointerMove(event) {
    if (this.activePointerId !== event.pointerId) return;
    if (this.pointerCard && this.getPointerDistanceFromPress(event) > DRAG_START_DISTANCE_PX) {
      this.clearPendingHold();
      if (this.heldCard) {
        this.heldCard.userData.targetHoldProgress = 0;
        this.heldCard = null;
      }
      if (!this.draggingCard) this.beginDrag(this.pointerCard);
    }

    if (this.draggingCard) {
      event.preventDefault();
      this.updateDragFromPointer(event);
    }
  }

  onPointerUp(event) {
    if (this.activePointerId !== event.pointerId) return;
    if (this.scrollContainer.hasPointerCapture(event.pointerId)) {
      this.scrollContainer.releasePointerCapture(event.pointerId);
    }

    this.clearPendingHold();

    this.endDrag();

    if (this.heldCard) this.heldCard.userData.targetHoldProgress = 0;
    this.pointerCard = null;
    this.heldCard = null;
    this.activePointerId = null;
  }

  onResize() {
    const width = this.scrollContainer.clientWidth;
    const rows = Math.max(Math.ceil(this.cards.length / GRID_COLUMNS), 1);
    const desiredHeight = Math.max(
      this.scrollContainer.clientHeight,
      rows * ROW_HEIGHT_PX + GRID_VERTICAL_PADDING_PX,
    );
    const viewportHeight = Math.max(this.scrollContainer.clientHeight, ROW_HEIGHT_PX);

    this.canvas.style.height = `${desiredHeight}px`;
    this.renderer.setSize(width, desiredHeight, false);

    this.camera.aspect = width / desiredHeight;

    const totalWidth = GRID_LEFT_PADDING * 2 + (GRID_COLUMNS - 1) * GRID_X_SPACING + CARD_WIDTH;
    const visibleRows = Math.min(Math.max(TARGET_VISIBLE_ROWS, 1), rows);
    const visibleHeight =
      GRID_TOP_PADDING +
      GRID_BOTTOM_PADDING +
      CARD_HEIGHT +
      (visibleRows - 1) * GRID_Y_SPACING +
      CAMERA_VERTICAL_OVERSCAN * 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const viewportAspect = width / viewportHeight;
    const fitDistanceX = totalWidth / (2 * Math.tan(fov / 2) * viewportAspect);
    const fitDistanceY = visibleHeight / (2 * Math.tan(fov / 2));
    const fitDistance = Math.max(fitDistanceX, fitDistanceY);
    const cameraX = totalWidth * 0.5;
    const cameraY = -(GRID_TOP_PADDING + CARD_HEIGHT * 0.5 + ((visibleRows - 1) * GRID_Y_SPACING) * 0.5);

    this.camera.position.set(cameraX, cameraY, fitDistance + 3.2);
    this.camera.lookAt(cameraX, cameraY, 0);
    this.camera.updateProjectionMatrix();
  }

  render() {
    const elapsed = this.clock.getElapsedTime();

    this.cardRoots.forEach((root) => {
      if (this.draggingCard === root) {
        root.position.set(this.dragPosition.x, this.dragPosition.y, DRAG_Z_OFFSET);
        root.rotation.set(0, 0, 0);
        root.scale.setScalar(HOLD_SCALE);
        root.userData.holdProgress = 0;
        return;
      }

      const { basePosition, phase } = root.userData;
      const swirlX = Math.sin(elapsed * 1.8 + phase) * 0.09;
      const swirlZ = Math.cos(elapsed * 1.45 + phase * 1.2) * 0.05;
      const ambientLift = basePosition.y + Math.sin(elapsed * 1.2 + phase * 0.7) * 0.12;

      root.position.set(basePosition.x + swirlX, ambientLift, basePosition.z + swirlZ);
      root.rotation.set(
        -0.06 + Math.sin(elapsed * 2.2 + phase) * 0.04,
        Math.sin(elapsed * 1.5 + phase * 0.5) * 0.18,
        Math.cos(elapsed * 1.8 + phase) * 0.03,
      );

      root.userData.holdProgress = THREE.MathUtils.damp(
        root.userData.holdProgress,
        root.userData.targetHoldProgress,
        8,
        1 / 60,
      );

      const holdProgress = root.userData.holdProgress;
      const holdScale = 1 + (HOLD_SCALE - 1) * holdProgress;
      root.scale.setScalar(holdScale);
      root.position.z += HOLD_Z_OFFSET * holdProgress;

      if (holdProgress < 0.02 && this.heldCard === root && root.userData.targetHoldProgress === 0) {
        this.heldCard = null;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }
}
