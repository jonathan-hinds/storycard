import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from '/public/card-game/render/CardMeshFactory.js';
import { createCardLabelTexture } from '/public/card-game/render/cardLabelTexture.js';
import { resolveCardKind, CARD_KINDS } from '/public/card-game/render/cardStyleConfig.js';
import {
  PREVIEW_BASE_POSITION,
  beginPreviewTransition,
  beginPreviewReturnTransition,
  getPreviewPose,
  loadPreviewTuning,
} from '/public/card-game/index.js';

const BASE_CARD_WIDTH = 1.8;
const BASE_CARD_HEIGHT = 2.5;
const CARD_THICKNESS = 0.08;
const CARD_SCALE = 0.78;
const CARD_COLUMNS = 2;
const COLUMN_PADDING = 0.35;
const ROW_PADDING = 0.42;
const DRAG_START_DISTANCE_PX = 6;
const PREVIEW_HIGHLIGHT_COLOR = 0x7bb0ff;
const MIN_VIEWPORT_HEIGHT_PX = 320;
const TARGET_VISIBLE_ROWS = 2;
const COMPACT_BREAKPOINT_PX = 900;
const DESKTOP_MIN_CANVAS_HEIGHT_PX = 460;
const MOBILE_MIN_CANVAS_HEIGHT_PX = 320;
const VIEWPORT_RESERVED_HEIGHT_PX = 140;
const DEFAULT_PREVIEW_CONTROLS = Object.freeze({
  x: PREVIEW_BASE_POSITION.x,
  y: PREVIEW_BASE_POSITION.y,
  z: PREVIEW_BASE_POSITION.z + 1.44,
  tiltX: -1.16,
});

function normalizePreviewControls(previewControls = {}, fallback = DEFAULT_PREVIEW_CONTROLS) {
  const read = (value, key) => (Number.isFinite(value) ? value : fallback[key]);
  return {
    x: read(previewControls.x, 'x'),
    y: read(previewControls.y, 'y'),
    z: read(previewControls.z, 'z'),
    tiltX: read(previewControls.tiltX, 'tiltX'),
  };
}

function createTitleSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 220;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'rgba(8, 14, 28, 0.85)';
  context.fillRect(32, 30, canvas.width - 64, canvas.height - 60);
  context.fillStyle = '#dce7ff';
  context.font = '700 112px "Trebuchet MS", "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(3.4, 0.74, 1);
  return sprite;
}

function createCountSprite(count) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '900 190px "Trebuchet MS", "Segoe UI", sans-serif';
  context.lineWidth = 22;
  context.strokeStyle = '#000000';
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.strokeText(String(count), canvas.width / 2, canvas.height / 2);
  context.fillText(String(count), canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(0.9, 0.9, 1);
  return sprite;
}

function makePane(name, centerX) {
  return { name, centerX, entries: [], scrollY: 0, scrollTargetY: 0, maxScrollY: 0 };
}

export class DeckBuilderScene {
  constructor({ canvas, interactionTarget, onDeckChange, previewControls = null }) {
    this.canvas = canvas;
    this.interactionTarget = interactionTarget;
    this.onDeckChange = onDeckChange;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.layout = {
      cardWidth: BASE_CARD_WIDTH * CARD_SCALE,
      cardHeight: BASE_CARD_HEIGHT * CARD_SCALE,
      xSpacing: (BASE_CARD_WIDTH * CARD_SCALE) + COLUMN_PADDING,
      ySpacing: (BASE_CARD_HEIGHT * CARD_SCALE) + ROW_PADDING,
    };

    this.previewTuning = loadPreviewTuning();
    this.previewCard = null;
    this.previewEntry = null;
    this.previewPose = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    this.previewOriginPose = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    this.previewTransition = { isActive: false, direction: 'toPreview', startedAt: 0, durationMs: 0 };
    this.previewStartedAt = 0;
    this.previewControls = normalizePreviewControls({
      x: PREVIEW_BASE_POSITION.x,
      y: PREVIEW_BASE_POSITION.y,
      z: PREVIEW_BASE_POSITION.z + this.previewTuning.cameraDistanceOffset,
      tiltX: this.previewTuning.rotationX,
      ...(previewControls || {}),
    });

    this.libraryPane = makePane('library', -3.2);
    this.deckPane = makePane('deck', 3.2);
    this.libraryCards = [];
    this.deckCounts = new Map();
    this.activePointerId = null;
    this.pointerDown = { x: 0, y: 0 };
    this.lastPointerY = 0;
    this.pointerEntry = null;
    this.activePane = null;
    this.viewportHeight = MIN_VIEWPORT_HEIGHT_PX;
    this.dragging = null;
    this.draggingScroll = null;

    this.titleLibrary = createTitleSprite('All Cards');
    this.titleDeck = createTitleSprite('Deck');
    if (this.titleLibrary) this.scene.add(this.titleLibrary);
    if (this.titleDeck) this.scene.add(this.titleDeck);

    const hemi = new THREE.HemisphereLight(0xdce8ff, 0x1a1f2c, 1.1);
    hemi.position.set(0, 18, 4);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 12, 9);
    this.scene.add(key);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onResize = this.onResize.bind(this);

    interactionTarget.addEventListener('pointerdown', this.onPointerDown);
    interactionTarget.addEventListener('pointermove', this.onPointerMove);
    interactionTarget.addEventListener('pointerup', this.onPointerUp);
    interactionTarget.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onResize);

    this.onResize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.interactionTarget.removeEventListener('pointerdown', this.onPointerDown);
    this.interactionTarget.removeEventListener('pointermove', this.onPointerMove);
    this.interactionTarget.removeEventListener('pointerup', this.onPointerUp);
    this.interactionTarget.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    this.clearEntries(this.libraryPane);
    this.clearEntries(this.deckPane);
    this.renderer.dispose();
  }

  setPreviewControls(nextControls = {}) {
    this.previewControls = normalizePreviewControls(nextControls, this.previewControls);
  }

  setCards(cards) {
    this.libraryCards = Array.isArray(cards) ? [...cards] : [];
    this.rebuildLibraryPane();
    this.rebuildDeckPane();
    this.emitDeckChange();
  }

  setDeckCardIds(cardIds = []) {
    this.deckCounts.clear();
    cardIds.forEach((id) => {
      if (typeof id !== 'string') return;
      this.deckCounts.set(id, (this.deckCounts.get(id) || 0) + 1);
    });
    this.rebuildDeckPane();
    this.emitDeckChange();
  }

  emitDeckChange() {
    const deckCardIds = [];
    this.deckCounts.forEach((count, id) => {
      for (let i = 0; i < count; i += 1) deckCardIds.push(id);
    });
    const creatureCount = deckCardIds
      .map((id) => this.libraryCards.find((card) => card.id === id))
      .filter((card) => resolveCardKind(card?.cardKind) === CARD_KINDS.CREATURE).length;
    const violations = [];
    if (deckCardIds.length > 10) violations.push('Deck cannot exceed 10 cards.');
    if (creatureCount < 3) violations.push('Deck must include at least 3 creature cards.');
    this.deckCounts.forEach((count, id) => {
      if (count > 2) violations.push(`Card ${id} cannot appear more than twice.`);
    });
    this.onDeckChange?.({
      deckCardIds,
      creatureCount,
      isValid: deckCardIds.length === 10 && creatureCount >= 3 && !violations.length,
      violations,
    });
  }

  rebuildLibraryPane() {
    this.closePreview({ immediate: true });
    this.clearEntries(this.libraryPane);
    this.libraryCards.forEach((card) => {
      const entry = this.createEntry(card, this.libraryPane, 1);
      this.libraryPane.entries.push(entry);
      this.scene.add(entry.root);
    });
    this.layoutPane(this.libraryPane);
  }

  rebuildDeckPane() {
    this.closePreview({ immediate: true });
    this.clearEntries(this.deckPane);
    const cards = [...this.deckCounts.entries()]
      .map(([id, count]) => ({ card: this.libraryCards.find((candidate) => candidate.id === id), count }))
      .filter(({ card }) => card);
    cards.forEach(({ card, count }) => {
      const entry = this.createEntry(card, this.deckPane, count);
      this.deckPane.entries.push(entry);
      this.scene.add(entry.root);
    });
    this.layoutPane(this.deckPane);
  }

  clearEntries(pane) {
    pane.entries.forEach((entry) => {
      const face = entry.root.userData.face;
      if (face?.material?.map) face.material.map.dispose();
      face?.material?.dispose?.();
      face?.geometry?.dispose?.();
      if (entry.countSprite) {
        entry.countSprite.material?.map?.dispose?.();
        entry.countSprite.material?.dispose?.();
      }
      this.scene.remove(entry.root);
    });
    pane.entries.length = 0;
  }

  setEntryHighlighted(entry, isHighlighted) {
    if (!entry?.root) return;
    const outlineMaterial = entry.root.userData.outline?.material;
    if (outlineMaterial?.color) {
      outlineMaterial.color.setHex(isHighlighted ? PREVIEW_HIGHLIGHT_COLOR : 0x000000);
    }
    entry.root.userData.isPreviewHighlighted = isHighlighted;
  }

  beginPreviewForEntry(entry) {
    if (!entry?.root) return;
    if (this.previewEntry && this.previewEntry !== entry) {
      this.setEntryHighlighted(this.previewEntry, false);
    }
    this.previewCard = entry.root;
    this.previewEntry = entry;
    this.setEntryHighlighted(entry, true);
    this.previewStartedAt = performance.now();
    this.previewOriginPose.position.copy(this.previewCard.position);
    this.previewOriginPose.rotation.copy(this.previewCard.rotation);
    this.previewPose.position.set(
      this.camera.position.x + this.previewControls.x,
      this.camera.position.y + this.previewControls.y,
      this.previewControls.z,
    );
    this.previewPose.rotation.set(this.previewControls.tiltX, 0, 0);
    beginPreviewTransition(this, this.previewStartedAt);
  }

  closePreview({ immediate = false } = {}) {
    if (!this.previewCard) return;
    if (immediate) {
      this.previewCard.position.copy(this.previewOriginPose.position);
      this.previewCard.rotation.copy(this.previewOriginPose.rotation);
      if (this.previewEntry) this.setEntryHighlighted(this.previewEntry, false);
      this.previewEntry = null;
      this.previewCard = null;
      this.previewTransition.isActive = false;
      return;
    }
    this.previewStartedAt = performance.now();
    beginPreviewReturnTransition(this, this.previewStartedAt);
  }

  getPointerDistance(event) {
    const dx = event.clientX - this.pointerDown.x;
    const dy = event.clientY - this.pointerDown.y;
    return Math.hypot(dx, dy);
  }

  createEntry(card, pane, count) {
    const root = CardMeshFactory.createCard({
      id: card.id,
      width: this.layout.cardWidth,
      height: this.layout.cardHeight,
      thickness: CARD_THICKNESS,
      cornerRadius: 0.15,
      color: 0x000000,
    });
    const texture = createCardLabelTexture(card);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(this.layout.cardWidth * 0.92, this.layout.cardHeight * 0.92),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75, metalness: 0.04 }),
    );
    face.position.set(0, 0, CARD_THICKNESS * 0.5 + 0.01);
    root.userData.tiltPivot.add(face);
    root.userData.face = face;
    root.userData.card = card;
    root.userData.pane = pane.name;
    root.userData.count = count;
    if (count > 1) {
      const countSprite = createCountSprite(count);
      countSprite.position.set(this.layout.cardWidth * 0.28, -this.layout.cardHeight * 0.26, 0.16);
      root.userData.tiltPivot.add(countSprite);
      root.userData.countSprite = countSprite;
    }
    return { card, pane: pane.name, count, root };
  }

  layoutPane(pane) {
    pane.entries.forEach((entry, index) => {
      const row = Math.floor(index / CARD_COLUMNS);
      const col = index % CARD_COLUMNS;
      entry.basePosition = new THREE.Vector3(
        pane.centerX + ((col - 0.5) * this.layout.xSpacing),
        -((row * this.layout.ySpacing) + this.layout.cardHeight * 0.5),
        0,
      );
      entry.root.position.copy(entry.basePosition);
      entry.root.userData.basePosition = entry.basePosition.clone();
    });
    const rows = Math.max(1, Math.ceil(pane.entries.length / CARD_COLUMNS));
    const viewRows = TARGET_VISIBLE_ROWS;
    pane.maxScrollY = Math.max(0, (rows - viewRows) * this.layout.ySpacing);
    pane.scrollY = THREE.MathUtils.clamp(pane.scrollY, 0, pane.maxScrollY);
    pane.scrollTargetY = THREE.MathUtils.clamp(pane.scrollTargetY, 0, pane.maxScrollY);
  }

  onResize() {
    const compactViewport = window.innerWidth <= COMPACT_BREAKPOINT_PX;
    const minCanvasHeight = compactViewport ? MOBILE_MIN_CANVAS_HEIGHT_PX : DESKTOP_MIN_CANVAS_HEIGHT_PX;
    const targetCanvasHeight = Math.max(minCanvasHeight, window.innerHeight - VIEWPORT_RESERVED_HEIGHT_PX);
    const width = Math.max(this.canvas.clientWidth, this.interactionTarget.clientWidth, 300);
    const height = Math.max(targetCanvasHeight, this.canvas.clientHeight, MIN_VIEWPORT_HEIGHT_PX);
    this.viewportHeight = height;
    this.canvas.style.height = `${height}px`;
    this.interactionTarget.style.minHeight = `${height}px`;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.position.set(0, -2.7, 11.2);
    this.camera.lookAt(0, -2.6, 0);
    this.camera.updateProjectionMatrix();
    if (this.titleLibrary) this.titleLibrary.position.set(this.libraryPane.centerX, 1.2, 0.4);
    if (this.titleDeck) this.titleDeck.position.set(this.deckPane.centerX, 1.2, 0.4);
  }

  raycastEntry(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const roots = [...this.libraryPane.entries, ...this.deckPane.entries].map((entry) => entry.root);
    const hits = this.raycaster.intersectObjects(roots, true);
    const hit = hits.find((candidate) => candidate.object?.userData?.cardRoot || candidate.object.parent);
    if (!hit) return null;
    let node = hit.object;
    while (node && !roots.includes(node)) node = node.parent;
    return [...this.libraryPane.entries, ...this.deckPane.entries].find((entry) => entry.root === node) || null;
  }

  paneFromPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    return x <= 0.5 ? this.libraryPane : this.deckPane;
  }

  onPointerDown(event) {
    this.activePointerId = event.pointerId;
    this.interactionTarget.setPointerCapture(event.pointerId);
    this.pointerDown = { x: event.clientX, y: event.clientY };
    this.lastPointerY = event.clientY;
    this.activePane = this.paneFromPointer(event);
    this.pointerEntry = this.raycastEntry(event);
    this.draggingScroll = null;
  }

  onPointerMove(event) {
    if (this.activePointerId !== event.pointerId) return;
    const dx = event.clientX - this.pointerDown.x;
    const dy = event.clientY - this.pointerDown.y;
    const dist = this.getPointerDistance(event);
    if (!this.dragging && !this.draggingScroll && this.pointerEntry && dist > DRAG_START_DISTANCE_PX) {
      if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        this.draggingScroll = this.activePane;
        this.pointerEntry = null;
      } else {
        this.dragging = this.pointerEntry;
        this.pointerEntry = null;
      }
    }
    if (!this.dragging && !this.draggingScroll && !this.pointerEntry && dist > DRAG_START_DISTANCE_PX) {
      this.draggingScroll = this.activePane;
    }
    if (this.dragging) {
      const pos = this.worldFromPointer(event);
      this.dragging.root.position.set(pos.x, pos.y, 0.65);
      this.dragging.root.rotation.set(0.16, 0, 0);
      this.lastPointerY = event.clientY;
      return;
    }
    if (this.draggingScroll) {
      const deltaY = event.clientY - this.lastPointerY;
      this.draggingScroll.scrollTargetY = THREE.MathUtils.clamp(
        this.draggingScroll.scrollTargetY - this.pixelsToWorldY(deltaY),
        0,
        this.draggingScroll.maxScrollY,
      );
    }
    this.lastPointerY = event.clientY;
  }

  onPointerUp(event) {
    if (this.activePointerId !== event.pointerId) return;
    const pointerDistance = this.getPointerDistance(event);
    if (this.dragging) {
      const targetPane = this.paneFromPointer(event);
      if (this.dragging.pane === 'library' && targetPane.name === 'deck') {
        this.addCardToDeck(this.dragging.card.id);
      }
      if (this.dragging.pane === 'deck' && targetPane.name === 'library') {
        this.removeCardFromDeck(this.dragging.card.id);
      }
      this.rebuildDeckPane();
      this.emitDeckChange();
    } else if (pointerDistance <= DRAG_START_DISTANCE_PX) {
      if (this.pointerEntry) {
        if (this.previewEntry === this.pointerEntry) {
          this.closePreview();
        } else {
          this.beginPreviewForEntry(this.pointerEntry);
        }
      } else if (this.previewCard) {
        this.closePreview();
      }
    }
    this.pointerEntry = null;
    this.activePane = null;
    this.dragging = null;
    this.draggingScroll = null;
    if (this.interactionTarget.hasPointerCapture(event.pointerId)) {
      this.interactionTarget.releasePointerCapture(event.pointerId);
    }
    this.activePointerId = null;
  }

  addCardToDeck(cardId) {
    const count = this.deckCounts.get(cardId) || 0;
    const total = [...this.deckCounts.values()].reduce((sum, value) => sum + value, 0);
    if (total >= 10 || count >= 2) return;
    this.deckCounts.set(cardId, count + 1);
  }

  removeCardFromDeck(cardId) {
    const count = this.deckCounts.get(cardId) || 0;
    if (!count) return;
    if (count === 1) this.deckCounts.delete(cardId);
    else this.deckCounts.set(cardId, count - 1);
  }


  pixelsToWorldY(pixelDelta) {
    const viewportHeightPx = Math.max(this.viewportHeight, MIN_VIEWPORT_HEIGHT_PX);
    const worldVisibleHeight = this.layout.cardHeight + ((TARGET_VISIBLE_ROWS - 1) * this.layout.ySpacing);
    return (pixelDelta / viewportHeightPx) * worldVisibleHeight;
  }

  worldFromPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const vector = new THREE.Vector3(x, y, 0.5).unproject(this.camera);
    const dir = vector.sub(this.camera.position).normalize();
    const distance = -this.camera.position.z / dir.z;
    return this.camera.position.clone().add(dir.multiplyScalar(distance));
  }

  render() {
    const elapsed = this.clock.getElapsedTime();
    [this.libraryPane, this.deckPane].forEach((pane) => {
      pane.scrollY = THREE.MathUtils.damp(pane.scrollY, pane.scrollTargetY, 14, 1 / 60);
      pane.entries.forEach((entry, index) => {
        if (entry.root === this.previewCard || entry === this.dragging) return;
        const phase = index * 0.31;
        const base = entry.root.userData.basePosition;
        const y = base.y + pane.scrollY + Math.sin(elapsed * 1.2 + phase) * 0.12;
        entry.root.position.set(base.x + Math.sin(elapsed * 0.8 + phase) * 0.07, y, base.z + Math.cos(elapsed * 0.95 + phase) * 0.04);
        entry.root.rotation.set(Math.sin(elapsed + phase) * 0.018, Math.cos(elapsed * 0.8 + phase) * 0.02, 0);
      });
    });

    if (this.previewCard) {
      this.previewPose.position.set(
        this.camera.position.x + this.previewControls.x,
        this.camera.position.y + this.previewControls.y,
        this.previewControls.z,
      );
      this.previewPose.rotation.set(this.previewControls.tiltX, 0, 0);
      const pose = getPreviewPose({
        mode: this.previewTransition.direction === 'fromPreview' ? 'preview-return' : 'preview',
        time: performance.now(),
        previewStartedAt: this.previewStartedAt,
        previewOriginPose: this.previewOriginPose,
        activePose: this.previewPose,
        previewTransition: this.previewTransition,
      });
      this.previewCard.position.copy(pose.position);
      this.previewCard.rotation.copy(pose.rotation);
      if (pose.transitionCompleted) {
        this.previewTransition.isActive = false;
        if (this.previewTransition.direction === 'fromPreview') {
          if (this.previewEntry) this.setEntryHighlighted(this.previewEntry, false);
          this.previewEntry = null;
          this.previewCard = null;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
