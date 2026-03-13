import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const CAMERA_FRUSTUM_HEIGHT = 9;
const PANEL_WIDTH = 7.1;
const PANEL_HEIGHT = 4.8;
const PANEL_DEPTH = 0.22;
const MAX_PIXEL_RATIO = 2;

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

function drawPanelTexture(canvas, profile) {
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

  const avatarCenterX = 130;
  const avatarCenterY = 116;
  const avatarRadius = 70;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
  ctx.clip();

  const avatarGradient = ctx.createLinearGradient(avatarCenterX - avatarRadius, avatarCenterY - avatarRadius, avatarCenterX + avatarRadius, avatarCenterY + avatarRadius);
  avatarGradient.addColorStop(0, '#efefef');
  avatarGradient.addColorStop(1, '#6d6d6d');
  ctx.fillStyle = avatarGradient;
  ctx.fillRect(avatarCenterX - avatarRadius, avatarCenterY - avatarRadius, avatarRadius * 2, avatarRadius * 2);

  ctx.fillStyle = '#141414';
  ctx.font = 'bold 56px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const avatarGlyph = String(profile?.username || '?').trim().charAt(0).toUpperCase() || '?';
  ctx.fillText(avatarGlyph, avatarCenterX, avatarCenterY);
  ctx.restore();

  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius + 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#efefef';
  ctx.font = '700 52px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(profile?.username || 'Guest User'), 230, 120);

  ctx.fillStyle = '#bcbcbc';
  ctx.font = '26px "Courier New", monospace';
  ctx.fillText('Profile Metrics', 230, 170);

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

export class ProfilePanelScene {
  constructor({ canvas, initialProfile = null }) {
    this.canvas = canvas;
    this.profile = initialProfile;

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
    this.renderFrame();
  }

  setProfile(profile) {
    this.profile = profile;
    drawPanelTexture(this.panelCanvas, this.profile);
    this.panelTexture.needsUpdate = true;
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
