import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const CAMERA_FRUSTUM_HEIGHT = 9;
const PANEL_WIDTH = 7.1;
const PANEL_HEIGHT = 4.8;
const PANEL_DEPTH = 0.22;
const MAX_PIXEL_RATIO = 2;

const AVATAR_CENTER_X = 130;
const AVATAR_CENTER_Y = 116;
const AVATAR_RADIUS = 70;

const ASSET_GRID = {
  x: 32,
  y: 246,
  width: 756,
  height: 382,
  columns: 4,
  gap: 14,
};

const SAVE_BUTTON_RECT = {
  x: 596,
  y: 90,
  width: 180,
  height: 58,
};

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

  if (line) {
    ctx.fillText(line, x, lineY);
  }
}

function drawCoverImage(ctx, image, x, y, width, height) {
  if (!image || !image.width || !image.height) return;
  const imageAspect = image.width / image.height;
  const targetAspect = width / height;
  let drawWidth = width;
  let drawHeight = height;
  let offsetX = x;
  let offsetY = y;

  if (imageAspect > targetAspect) {
    drawHeight = height;
    drawWidth = height * imageAspect;
    offsetX = x - ((drawWidth - width) * 0.5);
  } else {
    drawWidth = width;
    drawHeight = width / imageAspect;
    offsetY = y - ((drawHeight - height) * 0.5);
  }

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function pointInRect(point, rect) {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

export class ProfilePanelScene {
  constructor({ canvas, initialProfile = null, onRequestSaveAvatar = null }) {
    this.canvas = canvas;
    this.profile = initialProfile;
    this.onRequestSaveAvatar = onRequestSaveAvatar;

    this.avatarAssets = [];
    this.avatarAssetImages = new Map();
    this.avatarAssetRects = [];
    this.assetScrollY = 0;
    this.assetMaxScrollY = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    this.panelGroup = new THREE.Group();
    this.scene.add(this.panelGroup);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(2.5, 3, 5);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
    rimLight.position.set(-3.5, -2, 4);
    this.scene.add(rimLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(ambientLight);

    const panelGeometry = new THREE.BoxGeometry(PANEL_WIDTH, PANEL_HEIGHT, PANEL_DEPTH);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x060606,
      metalness: 0.28,
      roughness: 0.62,
    });
    this.panelBaseMesh = new THREE.Mesh(panelGeometry, panelMaterial);
    this.panelGroup.add(this.panelBaseMesh);

    const panelEdgeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.32,
      roughness: 0.45,
      emissive: 0x050505,
    });
    this.panelEdgeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_WIDTH + 0.06, PANEL_HEIGHT + 0.06, 0.05),
      panelEdgeMaterial,
    );
    this.panelEdgeMesh.position.z = -(PANEL_DEPTH * 0.52);
    this.panelGroup.add(this.panelEdgeMesh);

    const panelContent = createCanvasTexture(820, 680);
    this.panelCanvas = panelContent.canvas;
    this.panelTexture = panelContent.texture;

    const contentMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH - 0.35, PANEL_HEIGHT - 0.35),
      new THREE.MeshBasicMaterial({ map: this.panelTexture }),
    );
    contentMesh.position.z = PANEL_DEPTH * 0.54;
    this.panelGroup.add(contentMesh);

    this.onResize = this.onResize.bind(this);
    this.animationFrame = null;

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.canvas);

    this.onResize();
    this.renderFrame = this.renderFrame.bind(this);
    this.redrawPanel();
    this.renderFrame();
  }

  setProfile(profile) {
    this.profile = profile;
    this.redrawPanel();
  }

  setAvatarAssets(paths = []) {
    this.avatarAssets = Array.isArray(paths) ? paths : [];
    this.avatarAssetRects = [];
    this.assetScrollY = 0;
    this.assetMaxScrollY = 0;
    this.avatarAssets.forEach((assetPath) => {
      if (this.avatarAssetImages.has(assetPath)) return;
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => this.redrawPanel();
      image.src = assetPath;
      this.avatarAssetImages.set(assetPath, image);
    });
    this.redrawPanel();
  }

  redrawPanel() {
    const ctx = this.panelCanvas.getContext('2d');
    if (!ctx) return;

    const metrics = Array.isArray(this.profile?.metrics) ? this.profile.metrics.slice(0, 6) : [];
    const normalizedMetrics = metrics.map((metric) => ({
      name: String(metric?.name || ''),
      value: Number.isFinite(metric?.value) ? metric.value : 0,
    }));

    ctx.clearRect(0, 0, this.panelCanvas.width, this.panelCanvas.height);
    ctx.fillStyle = '#020202';
    ctx.fillRect(0, 0, this.panelCanvas.width, this.panelCanvas.height);

    ctx.strokeStyle = '#f8f8f8';
    ctx.lineWidth = 5;
    ctx.strokeRect(10, 10, this.panelCanvas.width - 20, this.panelCanvas.height - 20);

    const headerHeight = 220;
    ctx.strokeStyle = '#d8d8d8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(26, headerHeight);
    ctx.lineTo(this.panelCanvas.width - 26, headerHeight);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_CENTER_X, AVATAR_CENTER_Y, AVATAR_RADIUS, 0, Math.PI * 2);
    ctx.clip();

    const avatarImage = this.profile?.avatarImagePath ? this.avatarAssetImages.get(this.profile.avatarImagePath) : null;
    if (avatarImage && avatarImage.complete) {
      drawCoverImage(
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
      const avatarGlyph = String(this.profile?.username || '?').trim().charAt(0).toUpperCase() || '?';
      ctx.fillText(avatarGlyph, AVATAR_CENTER_X, AVATAR_CENTER_Y);
    }
    ctx.restore();

    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(AVATAR_CENTER_X, AVATAR_CENTER_Y, AVATAR_RADIUS + 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#bcbcbc';
    ctx.font = '20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Tap avatar to edit', AVATAR_CENTER_X, 206);

    ctx.fillStyle = '#efefef';
    ctx.font = '700 52px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(this.profile?.username || 'Guest User'), 230, 120);

    ctx.fillStyle = '#bcbcbc';
    ctx.font = '26px "Courier New", monospace';
    ctx.fillText('Profile Metrics', 230, 170);

    const canSave = Boolean(this.profile?.id && this.profile?.avatarImagePath);
    ctx.fillStyle = canSave ? '#ffffff' : '#616161';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.fillRect(SAVE_BUTTON_RECT.x, SAVE_BUTTON_RECT.y, SAVE_BUTTON_RECT.width, SAVE_BUTTON_RECT.height);
    ctx.strokeRect(SAVE_BUTTON_RECT.x, SAVE_BUTTON_RECT.y, SAVE_BUTTON_RECT.width, SAVE_BUTTON_RECT.height);
    ctx.fillStyle = canSave ? '#101010' : '#1f1f1f';
    ctx.font = '700 22px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SAVE AVATAR', SAVE_BUTTON_RECT.x + (SAVE_BUTTON_RECT.width * 0.5), SAVE_BUTTON_RECT.y + (SAVE_BUTTON_RECT.height * 0.5));

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
      const metricLabel = metric.name.toUpperCase();
      wrapText(ctx, metricLabel, x + 14, y + 18, cellWidth - 28, 28);

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 48px "Courier New", monospace';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(metric.value), x + 14, y + cellHeight - 28);
    });

    this.drawAssetPicker(ctx);
    this.panelTexture.needsUpdate = true;
  }

  drawAssetPicker(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillRect(ASSET_GRID.x - 10, ASSET_GRID.y - 12, ASSET_GRID.width + 20, ASSET_GRID.height + 42);
    ctx.strokeStyle = '#f8f8f8';
    ctx.lineWidth = 2;
    ctx.strokeRect(ASSET_GRID.x - 10, ASSET_GRID.y - 12, ASSET_GRID.width + 20, ASSET_GRID.height + 42);

    ctx.fillStyle = '#efefef';
    ctx.font = '700 20px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Avatar Assets (scroll)', ASSET_GRID.x, ASSET_GRID.y - 4);

    const cellWidth = Math.floor((ASSET_GRID.width - ((ASSET_GRID.columns - 1) * ASSET_GRID.gap)) / ASSET_GRID.columns);
    const cellHeight = 118;
    const rowCount = Math.ceil(this.avatarAssets.length / ASSET_GRID.columns);
    const contentHeight = rowCount > 0 ? ((rowCount * (cellHeight + ASSET_GRID.gap)) - ASSET_GRID.gap) : 0;
    this.assetMaxScrollY = Math.max(0, contentHeight - ASSET_GRID.height);
    this.assetScrollY = THREE.MathUtils.clamp(this.assetScrollY, 0, this.assetMaxScrollY);

    this.avatarAssetRects = [];

    ctx.save();
    ctx.beginPath();
    ctx.rect(ASSET_GRID.x, ASSET_GRID.y + 24, ASSET_GRID.width, ASSET_GRID.height - 24);
    ctx.clip();

    this.avatarAssets.forEach((assetPath, index) => {
      const col = index % ASSET_GRID.columns;
      const row = Math.floor(index / ASSET_GRID.columns);
      const x = ASSET_GRID.x + (col * (cellWidth + ASSET_GRID.gap));
      const y = ASSET_GRID.y + 24 + (row * (cellHeight + ASSET_GRID.gap)) - this.assetScrollY;
      const tileRect = { x, y, width: cellWidth, height: cellHeight };
      this.avatarAssetRects.push({ assetPath, ...tileRect });

      if (y + cellHeight < ASSET_GRID.y + 24 || y > ASSET_GRID.y + ASSET_GRID.height) {
        return;
      }

      const isSelected = this.profile?.avatarImagePath === assetPath;
      ctx.fillStyle = isSelected ? '#fafafa' : '#121212';
      ctx.fillRect(x, y, cellWidth, cellHeight);
      ctx.strokeStyle = '#f0f0f0';
      ctx.lineWidth = isSelected ? 4 : 2;
      ctx.strokeRect(x, y, cellWidth, cellHeight);

      const image = this.avatarAssetImages.get(assetPath);
      if (image && image.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 3, y + 3, cellWidth - 6, cellHeight - 30);
        ctx.clip();
        drawCoverImage(ctx, image, x + 3, y + 3, cellWidth - 6, cellHeight - 30);
        ctx.restore();
      }

      ctx.fillStyle = isSelected ? '#111111' : '#f0f0f0';
      ctx.font = '700 14px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = assetPath.split('/').pop() || assetPath;
      ctx.fillText(label.slice(0, 20), x + 6, y + cellHeight - 12);
    });

    ctx.restore();
  }

  canvasPixelPointFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * this.panelCanvas.width;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * this.panelCanvas.height;
    return { x, y };
  }

  onPointerDown(event) {
    const point = this.canvasPixelPointFromEvent(event);
    const distanceToAvatar = Math.hypot(point.x - AVATAR_CENTER_X, point.y - AVATAR_CENTER_Y);

    if (distanceToAvatar <= AVATAR_RADIUS + 8) {
      return true;
    }

    if (pointInRect(point, SAVE_BUTTON_RECT) && this.profile?.id && this.profile?.avatarImagePath) {
      this.onRequestSaveAvatar?.(this.profile.avatarImagePath);
      return true;
    }

    for (const tile of this.avatarAssetRects) {
      if (pointInRect(point, tile)) {
        this.profile = {
          ...this.profile,
          avatarImagePath: tile.assetPath,
        };
        this.redrawPanel();
        return true;
      }
    }

    return false;
  }

  onWheel(event) {
    const point = this.canvasPixelPointFromEvent(event);
    const viewportRect = {
      x: ASSET_GRID.x,
      y: ASSET_GRID.y + 24,
      width: ASSET_GRID.width,
      height: ASSET_GRID.height - 24,
    };
    if (!pointInRect(point, viewportRect)) return false;

    this.assetScrollY = THREE.MathUtils.clamp(this.assetScrollY + event.deltaY, 0, this.assetMaxScrollY);
    this.redrawPanel();
    return true;
  }

  onResize() {
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1);
    const aspect = width / height;
    const halfHeight = CAMERA_FRUSTUM_HEIGHT * 0.5;
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
    this.panelGroup.rotation.y = Math.sin(performance.now() * 0.0006) * 0.1;
    this.panelGroup.position.y = Math.sin(performance.now() * 0.001) * 0.08;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
    this.panelTexture?.dispose();
  }
}
