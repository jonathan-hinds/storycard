import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from '/public/card-game/render/CardMeshFactory.js';
import {
  PREVIEW_HOLD_DELAY_MS,
  PREVIEW_BASE_POSITION,
  beginPreviewTransition,
  beginPreviewReturnTransition,
  getPreviewPose,
  loadPreviewTuning,
} from '/public/card-game/index.js';

const DEFAULT_GRID_COLUMNS = 5;
const BASE_CARD_WIDTH = 1.8;
const BASE_CARD_HEIGHT = 2.5;
const CARD_THICKNESS = 0.08;
const DEFAULT_COLUMN_PADDING = 0;
const DEFAULT_ROW_PADDING = 0;
const DEFAULT_GRID_MARGIN = 0;
const DEFAULT_CARD_SCALE = 1;
const CARD_SCALE_CONTROL_MIN = 0.5;
const CARD_SCALE_CONTROL_MAX = 1.8;
const MIN_ROW_HEIGHT_PX = 280;
const TARGET_VISIBLE_ROWS = 2;
const CAMERA_VERTICAL_OVERSCAN = 0;
const COMPACT_BREAKPOINT_PX = 900;
const DESKTOP_MIN_CANVAS_HEIGHT_PX = 460;
const MOBILE_MIN_CANVAS_HEIGHT_PX = 320;
const VIEWPORT_RESERVED_HEIGHT_PX = 140;
const HOLD_CANCEL_DISTANCE_PX = 10;
const DRAG_START_DISTANCE_PX = 6;
const DEFAULT_PREVIEW_ROTATION_OFFSET = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
});

const DEFAULT_PREVIEW_POSITION_OFFSET = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
});

const DEFAULT_LAYOUT_TUNING = Object.freeze({
  cardsPerRow: DEFAULT_GRID_COLUMNS,
  columnPadding: DEFAULT_COLUMN_PADDING,
  rowPadding: DEFAULT_ROW_PADDING,
  gridMargin: DEFAULT_GRID_MARGIN,
  cardScale: DEFAULT_CARD_SCALE,
});
const CARD_FACE_Z_EPSILON = 0.01;
const CARD_LABEL_CANVAS_SIZE = 1024;
export const DEFAULT_CARD_LABEL_LAYOUT = Object.freeze({
  name: Object.freeze({ x: 512, y: 200, size: 74, color: '#dfe8ff', align: 'center' }),
  type: Object.freeze({ x: 512, y: 268, size: 40, color: '#9ab0d8', align: 'center' }),
  damage: Object.freeze({ x: 245, y: 757, size: 1 }),
  health: Object.freeze({ x: 529, y: 757, size: 1 }),
  speed: Object.freeze({ x: 813, y: 757, size: 1 }),
});

function normalizeTextColor(color, fallbackColor) {
  if (typeof color !== 'string') return fallbackColor;
  const normalized = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallbackColor;
}

function normalizeTextAlign(align, fallbackAlign) {
  const validAlignments = ['left', 'center', 'right'];
  return validAlignments.includes(align) ? align : fallbackAlign;
}

function getCardScaleFromControlValue(controlValue) {
  const clampedValue = THREE.MathUtils.clamp(controlValue, CARD_SCALE_CONTROL_MIN, CARD_SCALE_CONTROL_MAX);
  return CARD_SCALE_CONTROL_MIN + CARD_SCALE_CONTROL_MAX - clampedValue;
}

function getControlValueFromCardScale(cardScale) {
  const clampedScale = THREE.MathUtils.clamp(cardScale, CARD_SCALE_CONTROL_MIN, CARD_SCALE_CONTROL_MAX);
  return CARD_SCALE_CONTROL_MIN + CARD_SCALE_CONTROL_MAX - clampedScale;
}

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

function normalizeLabelElementLayout(layout, fallback) {
  return {
    x: Number.isFinite(layout?.x) ? layout.x : fallback.x,
    y: Number.isFinite(layout?.y) ? layout.y : fallback.y,
    size: Number.isFinite(layout?.size) ? Math.max(0.25, layout.size) : fallback.size,
    color: normalizeTextColor(layout?.color, fallback.color),
    align: normalizeTextAlign(layout?.align, fallback.align),
  };
}

function normalizeCardLabelLayout(cardLabelLayout = {}) {
  return {
    name: normalizeLabelElementLayout(cardLabelLayout.name, DEFAULT_CARD_LABEL_LAYOUT.name),
    type: normalizeLabelElementLayout(cardLabelLayout.type, DEFAULT_CARD_LABEL_LAYOUT.type),
    damage: normalizeLabelElementLayout(cardLabelLayout.damage, DEFAULT_CARD_LABEL_LAYOUT.damage),
    health: normalizeLabelElementLayout(cardLabelLayout.health, DEFAULT_CARD_LABEL_LAYOUT.health),
    speed: normalizeLabelElementLayout(cardLabelLayout.speed, DEFAULT_CARD_LABEL_LAYOUT.speed),
  };
}

function createCardLabelTexture(card, cardLabelLayout = DEFAULT_CARD_LABEL_LAYOUT) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_LABEL_CANVAS_SIZE;
  canvas.height = CARD_LABEL_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');

  if (card.backgroundImage instanceof HTMLImageElement) {
    ctx.drawImage(card.backgroundImage, 0, 0, canvas.width, canvas.height);
    const overlay = ctx.createLinearGradient(0, 0, CARD_LABEL_CANVAS_SIZE, CARD_LABEL_CANVAS_SIZE);
    overlay.addColorStop(0, 'rgba(8, 12, 22, 0.42)');
    overlay.addColorStop(1, 'rgba(6, 10, 18, 0.65)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, CARD_LABEL_CANVAS_SIZE, CARD_LABEL_CANVAS_SIZE);
    gradient.addColorStop(0, '#1f2a44');
    gradient.addColorStop(1, '#0d1321');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let index = 0; index < 14; index += 1) {
    drawRoundedRect(ctx, 42 + index * 8, 42 + index * 8, 940 - index * 16, 940 - index * 16, 28);
    ctx.fill();
  }

  ctx.fillStyle = cardLabelLayout.name.color;
  ctx.textAlign = cardLabelLayout.name.align;
  ctx.font = `bold ${Math.round(cardLabelLayout.name.size)}px Inter, system-ui, sans-serif`;
  ctx.fillText(card.name || 'Unnamed Card', cardLabelLayout.name.x, cardLabelLayout.name.y, 820);

  ctx.fillStyle = cardLabelLayout.type.color;
  ctx.textAlign = cardLabelLayout.type.align;
  ctx.font = `600 ${Math.round(cardLabelLayout.type.size)}px Inter, system-ui, sans-serif`;
  ctx.fillText(card.type || 'unknown', cardLabelLayout.type.x, cardLabelLayout.type.y, 720);

  const stats = [
    { key: 'damage', label: 'DMG', value: card.damage },
    { key: 'health', label: 'HP', value: card.health },
    { key: 'speed', label: 'SPD', value: card.speed },
  ];

  stats.forEach(({ key, label, value }) => {
    const elementLayout = cardLabelLayout[key];
    const width = 250 * elementLayout.size;
    const height = 250 * elementLayout.size;
    const left = elementLayout.x - width / 2;
    const top = elementLayout.y - height / 2;

    ctx.fillStyle = 'rgba(18, 24, 40, 0.82)';
    drawRoundedRect(ctx, left, top, width, height, 24);
    ctx.fill();

    ctx.fillStyle = '#8ea4cf';
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(36 * elementLayout.size)}px Inter, system-ui, sans-serif`;
    ctx.fillText(label, left + width / 2, top + (88 * elementLayout.size));

    ctx.fillStyle = '#f1f5ff';
    ctx.font = `700 ${Math.round(78 * elementLayout.size)}px Inter, system-ui, sans-serif`;
    ctx.fillText(String(value ?? '-'), left + width / 2, top + (188 * elementLayout.size));
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

export class CardLibraryScene {
  constructor({
    canvas,
    scrollContainer,
    previewRotationOffset = DEFAULT_PREVIEW_ROTATION_OFFSET,
    previewPositionOffset = DEFAULT_PREVIEW_POSITION_OFFSET,
    layoutTuning = DEFAULT_LAYOUT_TUNING,
    cardLabelLayout = DEFAULT_CARD_LABEL_LAYOUT,
  }) {
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
    this.activePointerId = null;
    this.pressPointer = { x: 0, y: 0 };
    this.lastPointerY = 0;
    this.pointerCard = null;
    this.holdTimeoutId = null;
    this.previewCard = null;
    this.previewTuning = loadPreviewTuning();
    this.previewPose = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    this.previewOriginPose = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    this.previewTransition = { isActive: false, direction: 'toPreview', startedAt: 0, durationMs: 0 };
    this.previewStartedAt = 0;
    this.previewRotationOffset = {
      x: Number.isFinite(previewRotationOffset?.x) ? previewRotationOffset.x : DEFAULT_PREVIEW_ROTATION_OFFSET.x,
      y: Number.isFinite(previewRotationOffset?.y) ? previewRotationOffset.y : DEFAULT_PREVIEW_ROTATION_OFFSET.y,
      z: Number.isFinite(previewRotationOffset?.z) ? previewRotationOffset.z : DEFAULT_PREVIEW_ROTATION_OFFSET.z,
    };
    this.previewPositionOffset = {
      x: Number.isFinite(previewPositionOffset?.x) ? previewPositionOffset.x : DEFAULT_PREVIEW_POSITION_OFFSET.x,
      y: Number.isFinite(previewPositionOffset?.y) ? previewPositionOffset.y : DEFAULT_PREVIEW_POSITION_OFFSET.y,
      z: Number.isFinite(previewPositionOffset?.z) ? previewPositionOffset.z : DEFAULT_PREVIEW_POSITION_OFFSET.z,
    };
    this.isDraggingScroll = false;
    this.scrollY = 0;
    this.scrollTargetY = 0;
    this.maxScrollY = 0;
    this.visibleRows = 1;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.layout = this.normalizeLayoutTuning(layoutTuning);
    this.cardLabelLayout = normalizeCardLabelLayout(cardLabelLayout);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
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

  setCardLabelLayout(cardLabelLayout = {}) {
    this.cardLabelLayout = normalizeCardLabelLayout({ ...this.cardLabelLayout, ...cardLabelLayout });
    this.cardRoots.forEach((root) => {
      const face = root.userData.face;
      const card = root.userData.catalogCard;
      if (!face || !card) return;
      const previousTexture = face.material.map;
      face.material.map = createCardLabelTexture(card, this.cardLabelLayout);
      face.material.needsUpdate = true;
      previousTexture?.dispose?.();
    });
  }

  normalizeLayoutTuning(layoutTuning = {}) {
    const cardsPerRow = Number.isFinite(layoutTuning.cardsPerRow)
      ? Math.max(1, Math.round(layoutTuning.cardsPerRow))
      : DEFAULT_LAYOUT_TUNING.cardsPerRow;
    const columnPadding = Number.isFinite(layoutTuning.columnPadding)
      ? Math.max(0, layoutTuning.columnPadding)
      : DEFAULT_LAYOUT_TUNING.columnPadding;
    const rowPadding = Number.isFinite(layoutTuning.rowPadding)
      ? Math.max(0, layoutTuning.rowPadding)
      : DEFAULT_LAYOUT_TUNING.rowPadding;
    const gridMargin = Number.isFinite(layoutTuning.gridMargin)
      ? Math.max(0, layoutTuning.gridMargin)
      : DEFAULT_LAYOUT_TUNING.gridMargin;
    const cardScale = Number.isFinite(layoutTuning.cardScale)
      ? getCardScaleFromControlValue(layoutTuning.cardScale)
      : DEFAULT_LAYOUT_TUNING.cardScale;

    return {
      cardsPerRow,
      columnPadding,
      rowPadding,
      gridMargin,
      cardScale,
    };
  }

  getLayoutMetrics() {
    const cardWidth = BASE_CARD_WIDTH * this.layout.cardScale;
    const cardHeight = BASE_CARD_HEIGHT * this.layout.cardScale;
    return {
      cardsPerRow: this.layout.cardsPerRow,
      cardWidth,
      cardHeight,
      gridXSpacing: cardWidth + this.layout.columnPadding,
      gridYSpacing: cardHeight + this.layout.rowPadding,
      gridLeftPadding: this.layout.gridMargin,
      gridTopPadding: this.layout.gridMargin,
      gridBottomPadding: this.layout.gridMargin,
    };
  }

  setLayoutTuning(layoutTuning = {}) {
    const currentControlValues = {
      ...this.layout,
      cardScale: getControlValueFromCardScale(this.layout.cardScale),
    };
    this.layout = this.normalizeLayoutTuning({ ...currentControlValues, ...layoutTuning });
    this.reflowCardPositions();
    this.onResize();
  }

  reflowCardPositions() {
    const {
      cardsPerRow,
      cardWidth,
      cardHeight,
      gridXSpacing,
      gridYSpacing,
      gridLeftPadding,
      gridTopPadding,
    } = this.getLayoutMetrics();

    this.cardRoots.forEach((root, index) => {
      const row = Math.floor(index / cardsPerRow);
      const column = index % cardsPerRow;
      const basePosition = new THREE.Vector3(
        gridLeftPadding + cardWidth * 0.5 + column * gridXSpacing,
        -(gridTopPadding + cardHeight * 0.5 + row * gridYSpacing),
        0,
      );
      root.userData.basePosition = basePosition;
      if (root !== this.previewCard) root.position.copy(basePosition);
    });
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
    this.activePointerId = null;
    this.previewCard = null;
    this.previewTransition.isActive = false;
  }

  setCards(cards) {
    this.clearCards();
    this.cards = cards.slice();
    const { cardsPerRow, cardWidth, cardHeight, gridXSpacing, gridYSpacing, gridLeftPadding, gridTopPadding } = this.getLayoutMetrics();

    this.cards.forEach((card, index) => {
      const row = Math.floor(index / cardsPerRow);
      const column = index % cardsPerRow;
      const basePosition = new THREE.Vector3(
        gridLeftPadding + cardWidth * 0.5 + column * gridXSpacing,
        -(gridTopPadding + cardHeight * 0.5 + row * gridYSpacing),
        0,
      );

      const root = CardMeshFactory.createCard({
        id: card.id,
        width: cardWidth,
        height: cardHeight,
        thickness: CARD_THICKNESS,
        cornerRadius: 0.15,
        color: colorForType(card.type),
      });

      const texture = createCardLabelTexture(card, this.cardLabelLayout);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(cardWidth * 0.92, cardHeight * 0.92),
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.75,
          metalness: 0.04,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      face.position.set(0, 0, (CARD_THICKNESS * 0.5) + CARD_FACE_Z_EPSILON);
      root.userData.tiltPivot.add(face);
      root.userData.face = face;

      root.userData.basePosition = basePosition;
      root.userData.phase = index * 0.63;
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

  getPointerDistance(event) {
    const dx = event.clientX - this.pressPointer.x;
    const dy = event.clientY - this.pressPointer.y;
    return Math.hypot(dx, dy);
  }

  clearHoldTimer() {
    if (!this.holdTimeoutId) return;
    window.clearTimeout(this.holdTimeoutId);
    this.holdTimeoutId = null;
  }

  releasePointerCapture() {
    if (this.activePointerId == null) return;
    if (!this.scrollContainer.hasPointerCapture(this.activePointerId)) return;
    this.scrollContainer.releasePointerCapture(this.activePointerId);
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    if (this.activePointerId != null) return;

    this.activePointerId = event.pointerId;
    this.pressPointer.x = event.clientX;
    this.pressPointer.y = event.clientY;
    this.lastPointerY = event.clientY;
    this.isDraggingScroll = false;

    this.scrollContainer.setPointerCapture(event.pointerId);

    const target = this.pickCard(event);
    this.pointerCard = target;
    if (!target) return;

    this.holdTimeoutId = window.setTimeout(() => {
      if (this.activePointerId !== event.pointerId || this.pointerCard !== target) return;
      this.previewCard = target;
      this.previewStartedAt = performance.now();
      this.previewOriginPose.position.copy(target.position);
      this.previewOriginPose.rotation.copy(target.rotation);
      this.previewPose.position.copy(this.getPreviewAnchorPosition());
      this.previewPose.rotation.set(
        this.previewTuning.rotationX + this.previewRotationOffset.x,
        this.previewRotationOffset.y,
        this.previewRotationOffset.z,
      );
      beginPreviewTransition(this, this.previewStartedAt);
    }, PREVIEW_HOLD_DELAY_MS);
  }

  getPreviewAnchorPosition() {
    return new THREE.Vector3(
      this.camera.position.x + PREVIEW_BASE_POSITION.x + this.previewPositionOffset.x,
      this.camera.position.y + PREVIEW_BASE_POSITION.y + this.previewPositionOffset.y,
      PREVIEW_BASE_POSITION.z + this.previewTuning.cameraDistanceOffset + this.previewPositionOffset.z,
    );
  }

  setPreviewDebugOffsets({ position = {}, rotation = {} } = {}) {
    if (Number.isFinite(position.x)) this.previewPositionOffset.x = position.x;
    if (Number.isFinite(position.y)) this.previewPositionOffset.y = position.y;
    if (Number.isFinite(position.z)) this.previewPositionOffset.z = position.z;
    if (Number.isFinite(rotation.x)) this.previewRotationOffset.x = rotation.x;
    if (Number.isFinite(rotation.y)) this.previewRotationOffset.y = rotation.y;
    if (Number.isFinite(rotation.z)) this.previewRotationOffset.z = rotation.z;
  }

  onPointerMove(event) {
    if (this.activePointerId !== event.pointerId) return;

    const pointerDistance = this.getPointerDistance(event);

    if (!this.previewCard && !this.isDraggingScroll && pointerDistance > DRAG_START_DISTANCE_PX) {
      this.isDraggingScroll = true;
      this.pointerCard = null;
      this.clearHoldTimer();
    }

    if (this.isDraggingScroll && !this.previewCard) {
      const deltaY = event.clientY - this.lastPointerY;
      this.scrollTargetY = THREE.MathUtils.clamp(this.scrollTargetY - this.pixelsToWorldY(deltaY), 0, this.maxScrollY);
      event.preventDefault();
    }

    this.lastPointerY = event.clientY;

    if (!this.previewCard && this.pointerCard && pointerDistance > HOLD_CANCEL_DISTANCE_PX) {
      this.clearHoldTimer();
      this.pointerCard = null;
    }

    if (this.previewCard) event.preventDefault();
  }

  onPointerUp(event) {
    if (this.activePointerId !== event.pointerId) return;

    this.clearHoldTimer();

    if (this.previewCard) {
      this.previewStartedAt = performance.now();
      beginPreviewReturnTransition(this, this.previewStartedAt);
    }

    this.releasePointerCapture();
    this.activePointerId = null;
    this.pointerCard = null;
    this.isDraggingScroll = false;
  }

  pixelsToWorldY(pixelDelta) {
    const { cardHeight, gridYSpacing } = this.getLayoutMetrics();
    const viewportHeightPx = Math.max(this.viewportHeight, MIN_ROW_HEIGHT_PX);
    const worldVisibleHeight = cardHeight + (this.visibleRows - 1) * gridYSpacing + CAMERA_VERTICAL_OVERSCAN * 2;
    return (pixelDelta / viewportHeightPx) * worldVisibleHeight;
  }

  getViewportSize() {
    const compactViewport = window.innerWidth <= COMPACT_BREAKPOINT_PX;
    const minCanvasHeight = compactViewport ? MOBILE_MIN_CANVAS_HEIGHT_PX : DESKTOP_MIN_CANVAS_HEIGHT_PX;
    const targetCanvasHeight = Math.max(minCanvasHeight, window.innerHeight - VIEWPORT_RESERVED_HEIGHT_PX);
    const width = Math.max(this.canvas.clientWidth, this.scrollContainer.clientWidth);
    const height = Math.max(targetCanvasHeight, this.canvas.clientHeight, MIN_ROW_HEIGHT_PX);
    return { width, height };
  }

  onResize() {
    const {
      cardsPerRow,
      cardWidth,
      cardHeight,
      gridXSpacing,
      gridYSpacing,
      gridLeftPadding,
      gridTopPadding,
      gridBottomPadding,
    } = this.getLayoutMetrics();
    const { width, height } = this.getViewportSize();
    const rows = Math.max(Math.ceil(this.cards.length / cardsPerRow), 1);
    const viewportHeight = height;
    const visibleRows = Math.min(Math.max(TARGET_VISIBLE_ROWS, 1), rows);
    this.visibleRows = visibleRows;
    const desiredHeight = viewportHeight;
    this.viewportWidth = width;
    this.viewportHeight = desiredHeight;

    this.canvas.style.height = `${desiredHeight}px`;
    this.scrollContainer.style.minHeight = `${desiredHeight}px`;

    this.renderer.setSize(width, desiredHeight, false);

    this.camera.aspect = width / desiredHeight;

    const totalWidth = gridLeftPadding * 2 + (cardsPerRow - 1) * gridXSpacing + cardWidth;
    const visibleHeight = gridTopPadding + gridBottomPadding + cardHeight + (visibleRows - 1) * gridYSpacing + CAMERA_VERTICAL_OVERSCAN * 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const viewportAspect = width / viewportHeight;
    const fitDistanceX = totalWidth / (2 * Math.tan(fov / 2) * viewportAspect);
    const fitDistanceY = visibleHeight / (2 * Math.tan(fov / 2));
    const fitDistance = Math.max(fitDistanceX, fitDistanceY);
    const cameraX = totalWidth * 0.5;
    const cameraBaseY = -(gridTopPadding + cardHeight * 0.5 + ((visibleRows - 1) * gridYSpacing) * 0.5);
    const totalRowsHeight = cardHeight + (rows - 1) * gridYSpacing;
    const maxVisibleRowsHeight = cardHeight + (visibleRows - 1) * gridYSpacing;
    this.maxScrollY = Math.max(totalRowsHeight - maxVisibleRowsHeight, 0);
    this.scrollY = THREE.MathUtils.clamp(this.scrollY, 0, this.maxScrollY);
    this.scrollTargetY = THREE.MathUtils.clamp(this.scrollTargetY, 0, this.maxScrollY);
    const cameraY = cameraBaseY - this.scrollY;

    this.camera.position.set(cameraX, cameraY, fitDistance + 3.2);
    this.camera.lookAt(cameraX, cameraY, 0);
    this.camera.updateProjectionMatrix();
  }

  render() {
    const elapsed = this.clock.getElapsedTime();
    const { width, height } = this.getViewportSize();
    if (width !== this.viewportWidth || height !== this.viewportHeight) this.onResize();

    this.scrollY = THREE.MathUtils.damp(this.scrollY, this.scrollTargetY, 14, 1 / 60);

    const { cardHeight, gridYSpacing, gridTopPadding } = this.getLayoutMetrics();
    const cameraX = this.camera.position.x;
    const cameraBaseY = -(gridTopPadding + cardHeight * 0.5 + ((this.visibleRows - 1) * gridYSpacing) * 0.5);
    const cameraY = cameraBaseY - this.scrollY;
    if (Math.abs(this.camera.position.y - cameraY) > 0.0001) {
      this.camera.position.y = cameraY;
      this.camera.lookAt(cameraX, cameraY, 0);
    }

    const now = performance.now();

    this.cardRoots.forEach((root) => {
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

      if (root === this.previewCard) {
        this.previewPose.position.copy(this.getPreviewAnchorPosition());
        const { position, rotation, transitionCompleted } = getPreviewPose({
          time: now,
          mode: this.previewTransition.direction === 'fromPreview' ? 'preview-return' : 'preview',
          previewStartedAt: this.previewStartedAt,
          previewOriginPose: this.previewOriginPose,
          activePose: this.previewPose,
          previewTransition: this.previewTransition,
        });

        root.position.copy(position);
        root.rotation.copy(rotation);
        root.renderOrder = 20;

        if (transitionCompleted) {
          this.previewTransition.isActive = false;
          if (this.previewTransition.direction === 'fromPreview') this.previewCard = null;
        }
      } else {
        root.scale.setScalar(1);
        root.renderOrder = 0;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }
}
