import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const CAMERA_FRUSTUM_HEIGHT = 9;
const PANEL_WIDTH = 7.1;
const PANEL_HEIGHT = 4.8;
const PANEL_DEPTH = 0.22;
const MAX_PIXEL_RATIO = 2;
const PANEL_FRAME_PADDING = 0.9;
const AVATAR_CENTER_X = 130;
const AVATAR_CENTER_Y = 116;
const AVATAR_RADIUS = 70;
const PICKER_RECT = { x: 40, y: 248, width: 740, height: 396 };
const PICKER_SAVE_BUTTON = { x: 558, y: 86, width: 218, height: 54 };
const TILE_COLUMNS = 2;
const TILE_GAP = 20;

function getPickerGridLayout() {
  const cols = TILE_COLUMNS;
  const tileSize = Math.floor((PICKER_RECT.width - (TILE_GAP * (cols - 1))) / cols);
  return { cols, tileSize };
}

function createCanvasTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  let lineY = y;
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      return;
    }
    if (line) {
      ctx.fillText(line, x, lineY);
      lineY += lineHeight;
    }
    line = word;
  });
  if (line) ctx.fillText(line, x, lineY);
}

function drawImageCover(ctx, image, x, y, width, height) {
  const sw = image.naturalWidth || image.width;
  const sh = image.naturalHeight || image.height;
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = x + (width - dw) * 0.5;
  const dy = y + (height - dh) * 0.5;
  ctx.drawImage(image, dx, dy, dw, dh);
}

function drawImageCoverClipped(ctx, image, x, y, width, height) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  drawImageCover(ctx, image, x, y, width, height);
  ctx.restore();
}

function drawAvatarCircle(ctx, profile, avatarImage) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_CENTER_X, AVATAR_CENTER_Y, AVATAR_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  if (avatarImage) {
    drawImageCover(
      ctx,
      avatarImage,
      AVATAR_CENTER_X - AVATAR_RADIUS,
      AVATAR_CENTER_Y - AVATAR_RADIUS,
      AVATAR_RADIUS * 2,
      AVATAR_RADIUS * 2,
    );
  } else {
    const avatarGradient = ctx.createLinearGradient(AVATAR_CENTER_X - AVATAR_RADIUS, AVATAR_CENTER_Y - AVATAR_RADIUS, AVATAR_CENTER_X + AVATAR_RADIUS, AVATAR_CENTER_Y + AVATAR_RADIUS);
    avatarGradient.addColorStop(0, '#efefef');
    avatarGradient.addColorStop(1, '#6d6d6d');
    ctx.fillStyle = avatarGradient;
    ctx.fillRect(AVATAR_CENTER_X - AVATAR_RADIUS, AVATAR_CENTER_Y - AVATAR_RADIUS, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
    ctx.fillStyle = '#141414';
    ctx.font = 'bold 56px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const avatarGlyph = String(profile?.username || '?').trim().charAt(0).toUpperCase() || '?';
    ctx.fillText(avatarGlyph, AVATAR_CENTER_X, AVATAR_CENTER_Y);
  }
  ctx.restore();

  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(AVATAR_CENTER_X, AVATAR_CENTER_Y, AVATAR_RADIUS + 2, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPanelTexture(canvas, state) {
  const { profile, pickerOpen, assets, loadedImages, pickerScrollY, selectedAssetPath } = state;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const metrics = Array.isArray(profile?.metrics) ? profile.metrics.slice(0, 6) : [];
  const normalizedMetrics = metrics.map((metric) => ({
    name: String(metric?.name || ''),
    value: Number.isFinite(metric?.value) ? metric.value : 0,
  }));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#020202';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#f8f8f8';
  ctx.lineWidth = 5;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  const headerHeight = 220;
  ctx.strokeStyle = '#d8d8d8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(26, headerHeight);
  ctx.lineTo(canvas.width - 26, headerHeight);
  ctx.stroke();

  drawAvatarCircle(ctx, profile, loadedImages.get(profile?.avatarImagePath || null));

  ctx.fillStyle = '#efefef';
  ctx.font = '700 52px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(profile?.username || 'Guest User'), 230, 120);

  ctx.fillStyle = '#bcbcbc';
  ctx.font = '26px "Courier New", monospace';
  ctx.fillText(pickerOpen ? 'Select Avatar' : 'Profile Metrics', 230, 170);

  if (pickerOpen) {
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 2;
    ctx.strokeRect(PICKER_RECT.x, PICKER_RECT.y, PICKER_RECT.width, PICKER_RECT.height);

    const { cols, tileSize } = getPickerGridLayout();
    const rows = Math.ceil(assets.length / cols);
    const contentHeight = rows * (tileSize + TILE_GAP) - TILE_GAP;
    const maxScrollY = Math.max(contentHeight - PICKER_RECT.height, 0);
    const scrollY = Math.max(0, Math.min(pickerScrollY, maxScrollY));
    state.pickerMaxScrollY = maxScrollY;
    state.pickerScrollY = scrollY;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PICKER_RECT.x, PICKER_RECT.y, PICKER_RECT.width, PICKER_RECT.height);
    ctx.clip();

    assets.forEach((asset, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = PICKER_RECT.x + col * (tileSize + TILE_GAP);
      const y = PICKER_RECT.y + row * (tileSize + TILE_GAP) - scrollY;
      if (y + tileSize < PICKER_RECT.y - tileSize || y > PICKER_RECT.y + PICKER_RECT.height + tileSize) return;

      ctx.fillStyle = '#0e0e0e';
      ctx.fillRect(x, y, tileSize, tileSize);
      const image = loadedImages.get(asset.path);
      if (image) {
        drawImageCoverClipped(ctx, image, x, y, tileSize, tileSize);
      }
      ctx.strokeStyle = selectedAssetPath === asset.path ? '#ffffff' : '#666666';
      ctx.lineWidth = selectedAssetPath === asset.path ? 4 : 2;
      ctx.strokeRect(x, y, tileSize, tileSize);
    });

    ctx.restore();

    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(PICKER_SAVE_BUTTON.x, PICKER_SAVE_BUTTON.y, PICKER_SAVE_BUTTON.width, PICKER_SAVE_BUTTON.height);
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 2;
    ctx.strokeRect(PICKER_SAVE_BUTTON.x, PICKER_SAVE_BUTTON.y, PICKER_SAVE_BUTTON.width, PICKER_SAVE_BUTTON.height);
    ctx.fillStyle = '#f4f4f4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 24px "Courier New", monospace';
    ctx.fillText('Save Avatar', PICKER_SAVE_BUTTON.x + PICKER_SAVE_BUTTON.width * 0.5, PICKER_SAVE_BUTTON.y + PICKER_SAVE_BUTTON.height * 0.5);
  } else {
    const gridTop = 264;
    const cellWidth = 232;
    const cellHeight = 170;
    const startX = 40;
    const gapX = 24;
    const gapY = 18;
    normalizedMetrics.forEach((metric, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = startX + (col * (cellWidth + gapX));
      const y = gridTop + (row * (cellHeight + gapY));
      ctx.fillStyle = '#0e0e0e';
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, cellWidth, cellHeight);
      ctx.strokeRect(x, y, cellWidth, cellHeight);
      ctx.fillStyle = '#f4f4f4';
      ctx.font = '700 22px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      wrapText(ctx, metric.name.toUpperCase(), x + 14, y + 18, cellWidth - 28, 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 48px "Courier New", monospace';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(metric.value), x + 14, y + cellHeight - 28);
    });
  }
}

function inRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export class ProfilePanelScene {
  constructor({ canvas, initialProfile = null, onAvatarSave = null }) {
    this.canvas = canvas;
    this.profile = initialProfile;
    this.onAvatarSave = onAvatarSave;
    this.assets = [];
    this.loadedImages = new Map();
    this.pickerOpen = false;
    this.pickerScrollY = 0;
    this.pickerMaxScrollY = 0;
    this.selectedAssetPath = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.activePointerId = null;
    this.isDraggingScroll = false;
    this.lastPointerY = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    this.panelGroup = new THREE.Group();
    this.scene.add(this.panelGroup);
    this.scene.add(new THREE.DirectionalLight(0xffffff, 0.85));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    this.panelBaseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_WIDTH, PANEL_HEIGHT, PANEL_DEPTH),
      new THREE.MeshStandardMaterial({ color: 0x060606, metalness: 0.28, roughness: 0.62 }),
    );
    this.panelGroup.add(this.panelBaseMesh);

    const panelContent = createCanvasTexture(820, 680);
    this.panelCanvas = panelContent.canvas;
    this.panelTexture = panelContent.texture;

    this.contentMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH - 0.35, PANEL_HEIGHT - 0.35),
      new THREE.MeshBasicMaterial({ map: this.panelTexture }),
    );
    this.contentMesh.position.z = PANEL_DEPTH * 0.54;
    this.panelGroup.add(this.contentMesh);

    this.onResize = this.onResize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.canvas);
    this.onResize();
    this.renderFrame = this.renderFrame.bind(this);
    this.renderFrame();
  }

  async setAssets(assets = []) {
    this.assets = Array.isArray(assets) ? assets : [];
    await Promise.all(this.assets.map(async (asset) => {
      if (!asset?.path || this.loadedImages.has(asset.path)) return;
      const image = new Image();
      image.src = asset.path;
      await image.decode().catch(() => {});
      this.loadedImages.set(asset.path, image);
    }));
    this.redraw();
  }

  setProfile(profile) {
    this.profile = profile;
    this.selectedAssetPath = profile?.avatarImagePath || null;
    this.redraw();
  }

  redraw() {
    drawPanelTexture(this.panelCanvas, this);
    this.panelTexture.needsUpdate = true;
  }

  canvasPointFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.contentMesh)[0];
    if (!hit?.uv) return null;
    return {
      x: hit.uv.x * this.panelCanvas.width,
      y: (1 - hit.uv.y) * this.panelCanvas.height,
    };
  }

  onPointerDown(event) {
    if (event.button !== 0 || this.activePointerId != null) return;
    this.activePointerId = event.pointerId;
    this.isDraggingScroll = false;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    if (this.activePointerId !== event.pointerId || !this.pickerOpen) return;
    const deltaY = event.clientY - this.lastPointerY;
    if (Math.abs(deltaY) > 2) this.isDraggingScroll = true;
    if (this.isDraggingScroll) {
      this.pickerScrollY = THREE.MathUtils.clamp(this.pickerScrollY - deltaY, 0, this.pickerMaxScrollY);
      this.redraw();
      event.preventDefault();
    }
    this.lastPointerY = event.clientY;
  }

  onWheel(event) {
    if (!this.pickerOpen) return;
    const point = this.canvasPointFromEvent(event);
    if (!point || !inRect(point.x, point.y, PICKER_RECT)) return;
    this.pickerScrollY = THREE.MathUtils.clamp(this.pickerScrollY + event.deltaY, 0, this.pickerMaxScrollY);
    this.redraw();
    event.preventDefault();
  }

  async onPointerUp(event) {
    if (this.activePointerId !== event.pointerId) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.activePointerId = null;

    const point = this.canvasPointFromEvent(event);
    if (!point) return;

    const avatarDistance = Math.hypot(point.x - AVATAR_CENTER_X, point.y - AVATAR_CENTER_Y);
    if (!this.pickerOpen && avatarDistance <= AVATAR_RADIUS + 8) {
      this.pickerOpen = true;
      this.redraw();
      return;
    }

    if (!this.pickerOpen || this.isDraggingScroll) return;

    if (inRect(point.x, point.y, PICKER_SAVE_BUTTON)) {
      if (typeof this.onAvatarSave === 'function') await this.onAvatarSave(this.selectedAssetPath);
      this.pickerOpen = false;
      this.redraw();
      return;
    }

    if (!inRect(point.x, point.y, PICKER_RECT)) return;

    const { cols, tileSize } = getPickerGridLayout();
    const localX = point.x - PICKER_RECT.x;
    const localY = point.y - PICKER_RECT.y + this.pickerScrollY;
    const col = Math.floor(localX / (tileSize + TILE_GAP));
    const row = Math.floor(localY / (tileSize + TILE_GAP));
    if (col < 0 || col >= cols || row < 0) return;
    const withinTileX = localX - (col * (tileSize + TILE_GAP));
    const withinTileY = localY - (row * (tileSize + TILE_GAP));
    if (withinTileX < 0 || withinTileX > tileSize || withinTileY < 0 || withinTileY > tileSize) return;
    const index = row * cols + col;
    const asset = this.assets[index];
    if (!asset?.path) return;
    this.selectedAssetPath = asset.path;
    this.profile = { ...(this.profile || {}), avatarImagePath: asset.path };
    this.redraw();
  }

  onResize() {
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1);
    const aspect = width / height;
    const baseHalfHeight = CAMERA_FRUSTUM_HEIGHT * 0.5;
    const panelHalfHeight = (PANEL_HEIGHT + PANEL_FRAME_PADDING) * 0.5;
    const panelHalfWidth = (PANEL_WIDTH + PANEL_FRAME_PADDING) * 0.5;
    const minHalfHeightForPanelWidth = panelHalfWidth / Math.max(aspect, 0.001);
    const halfHeight = Math.max(baseHalfHeight, panelHalfHeight, minHalfHeightForPanelWidth);
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
  }

  renderFrame() {
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.renderer?.dispose();
    this.panelTexture?.dispose();
  }
}
