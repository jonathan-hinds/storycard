import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const USER_SESSION_KEY = 'storycard-user-session';
const METRIC_DEFINITIONS = [
  { key: 'totalGamesPlayed', label: 'Games' },
  { key: 'totalWins', label: 'Wins' },
  { key: 'totalLosses', label: 'Losses' },
  { key: 'totalCreaturesKilled', label: 'Kills' },
  { key: 'totalCreaturesLost', label: 'Lost' },
  { key: 'totalSpellsPlayed', label: 'Spells' },
];

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (error) {
    return null;
  }
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function readSession() {
  try {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();
    const raw = sessionStorageRef?.getItem(USER_SESSION_KEY) || localStorageRef?.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    if (sessionStorageRef) sessionStorageRef.setItem(USER_SESSION_KEY, raw);
    if (localStorageRef) localStorageRef.removeItem(USER_SESSION_KEY);
    return parsed;
  } catch (error) {
    return null;
  }
}

function saveSession(user) {
  const session = JSON.stringify({ user });
  const sessionStorageRef = getSessionStorage();
  if (sessionStorageRef) sessionStorageRef.setItem(USER_SESSION_KEY, session);
  const localStorageRef = getLocalStorage();
  if (localStorageRef) localStorageRef.removeItem(USER_SESSION_KEY);
}

function getMetricValue(metrics, key) {
  const rawValue = Number(metrics?.[key]);
  return Number.isFinite(rawValue) ? Math.max(0, Math.floor(rawValue)) : 0;
}

class ProfilePanelCanvasScene {
  constructor({ canvas, stage }) {
    this.canvas = canvas;
    this.stage = stage;
    this.textureRefs = [];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x090d17, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    this.camera.position.set(0, 0, 12.5);

    const keyLight = new THREE.DirectionalLight(0xcbe0ff, 1.05);
    keyLight.position.set(5, 7, 12);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x6f95d8, 0.55);
    fillLight.position.set(-6, -1.5, 7);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x8dc1ff, 1.35, 28, 2.1);
    rimLight.position.set(0, -3.6, 8);
    this.scene.add(rimLight);

    this.panelGroup = new THREE.Group();
    this.panelGroup.rotation.x = -0.12;
    this.panelGroup.rotation.y = 0.2;
    this.scene.add(this.panelGroup);

    this.panelMesh = new THREE.Mesh(
      new THREE.BoxGeometry(10.3, 4.5, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x13213a,
        roughness: 0.5,
        metalness: 0.5,
        emissive: 0x0a1222,
      })
    );
    this.panelGroup.add(this.panelMesh);

    this.createAvatarMeshes();
    this.metricsGroup = new THREE.Group();
    this.panelGroup.add(this.metricsGroup);

    this.onResize = this.onResize.bind(this);
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.stage);

    this.onResize();
    this.renderer.setAnimationLoop((timeMs) => {
      const wobble = Math.sin(timeMs * 0.00085) * 0.045;
      this.panelGroup.rotation.y = 0.17 + wobble;
      this.panelGroup.rotation.x = -0.11 + Math.cos(timeMs * 0.00065) * 0.013;
      this.renderer.render(this.scene, this.camera);
    });
  }

  createTextTexture(text, { width = 600, height = 180, fontSize = 72, color = '#e7efff', weight = 700 } = {}) {
    const textCanvas = document.createElement('canvas');
    textCanvas.width = width;
    textCanvas.height = height;
    const context = textCanvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    context.font = `${weight} ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(textCanvas);
    texture.needsUpdate = true;
    this.textureRefs.push(texture);
    return texture;
  }

  createAvatarTexture(username = '?') {
    const initials = username
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((token) => token[0].toUpperCase())
      .join('') || '?';

    const avatarCanvas = document.createElement('canvas');
    avatarCanvas.width = 360;
    avatarCanvas.height = 360;
    const context = avatarCanvas.getContext('2d');

    const gradient = context.createLinearGradient(0, 0, avatarCanvas.width, avatarCanvas.height);
    gradient.addColorStop(0, '#3b8cff');
    gradient.addColorStop(1, '#5e56dc');
    context.fillStyle = gradient;
    context.fillRect(0, 0, avatarCanvas.width, avatarCanvas.height);

    context.fillStyle = 'rgba(255, 255, 255, 0.15)';
    context.beginPath();
    context.arc(272, 90, 84, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#f2f7ff';
    context.font = '700 150px "Trebuchet MS", "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(initials, avatarCanvas.width / 2, avatarCanvas.height / 2 + 6);

    const texture = new THREE.CanvasTexture(avatarCanvas);
    texture.needsUpdate = true;
    this.textureRefs.push(texture);
    return texture;
  }

  createAvatarMeshes() {
    this.avatarRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.08, 16, 80),
      new THREE.MeshStandardMaterial({
        color: 0x8db4ff,
        emissive: 0x2b4478,
        roughness: 0.32,
        metalness: 0.7,
      })
    );
    this.avatarRing.position.set(-3.62, 0, 0.2);
    this.panelGroup.add(this.avatarRing);

    this.avatarDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.03, 64),
      new THREE.MeshBasicMaterial({ map: this.createAvatarTexture('?') })
    );
    this.avatarDisc.position.set(-3.62, 0, 0.19);
    this.panelGroup.add(this.avatarDisc);
  }

  clearMetrics() {
    this.metricsGroup.children.forEach((child) => {
      child.traverse((node) => {
        if (node.material?.map) node.material.map.dispose();
        if (node.material?.dispose) node.material.dispose();
        if (node.geometry?.dispose) node.geometry.dispose();
      });
    });
    this.metricsGroup.clear();
  }

  setProfile(user = {}) {
    this.clearMetrics();

    const title = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.createTextTexture(user.username || 'Unknown', { width: 900, height: 180, fontSize: 82 }) }));
    title.position.set(0.8, 1.54, 0.24);
    title.scale.set(4.3, 0.84, 1);
    this.panelGroup.add(title);

    if (this.titleSprite) {
      this.panelGroup.remove(this.titleSprite);
      this.titleSprite.material.map?.dispose();
      this.titleSprite.material.dispose();
    }
    this.titleSprite = title;

    const metrics = user.metrics || {};
    METRIC_DEFINITIONS.forEach((definition, index) => {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(1.95, 1.15, 0.16),
        new THREE.MeshStandardMaterial({
          color: 0x1a2b49,
          roughness: 0.5,
          metalness: 0.28,
          emissive: 0x111f35,
        })
      );
      const column = index % 3;
      const row = Math.floor(index / 3);
      tile.position.set(-0.7 + column * 2.22, 0.4 - row * 1.44, 0.2);
      this.metricsGroup.add(tile);

      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.createTextTexture(definition.label, { width: 480, height: 150, fontSize: 48, color: '#adc4ef', weight: 700 }) })
      );
      label.position.set(0, 0.28, 0.1);
      label.scale.set(1.3, 0.36, 1);
      tile.add(label);

      const value = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.createTextTexture(String(getMetricValue(metrics, definition.key)), { width: 500, height: 180, fontSize: 72, color: '#ffffff', weight: 800 }) })
      );
      value.position.set(0, -0.18, 0.1);
      value.scale.set(1.45, 0.5, 1);
      tile.add(value);
    });

    this.avatarDisc.material.map?.dispose();
    this.avatarDisc.material.map = this.createAvatarTexture(user.username || '?');
    this.avatarDisc.material.needsUpdate = true;
  }

  onResize() {
    const stageRect = this.stage.getBoundingClientRect();
    const width = Math.max(stageRect.width || window.innerWidth, 320);
    const height = Math.max(stageRect.height || window.innerHeight, 320);
    this.renderer.setSize(width, height, false);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    const mobile = width < 760;
    this.panelGroup.scale.setScalar(mobile ? 0.84 : 1);
    this.panelGroup.position.set(mobile ? 0.15 : 0, mobile ? -0.1 : 0, 0);
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.clearMetrics();
    if (this.titleSprite) {
      this.titleSprite.material.map?.dispose();
      this.titleSprite.material.dispose();
      this.titleSprite = null;
    }
    this.textureRefs.forEach((texture) => texture.dispose());
    this.textureRefs = [];
    this.renderer.dispose();
  }
}

const loginForm = document.getElementById('user-profile-login-form');
const loginButton = document.getElementById('user-profile-login-button');
const sessionButton = document.getElementById('user-profile-session-button');
const statusEl = document.getElementById('user-profile-login-status');
const canvas = document.getElementById('user-profile-canvas');
const stage = document.getElementById('user-profile-stage');
const usernameInput = document.getElementById('user-profile-username');
const passwordInput = document.getElementById('user-profile-password');

const scene = new ProfilePanelCanvasScene({ canvas, stage });

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? 'true' : 'false';
}

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  sessionButton.disabled = isLoading;
}

function applyProfile(user) {
  scene.setProfile(user);
  setStatus(`Previewing ${user.username}'s profile metrics.`);
}

async function login(credentials) {
  const response = await fetch('/api/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'Unable to sign in');
  }
  return payload?.user;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(true);
  setStatus('Signing in...');
  try {
    const user = await login({
      username: usernameInput.value,
      password: passwordInput.value,
    });
    if (!user?.id) {
      throw new Error('User session was missing from response');
    }
    saveSession(user);
    applyProfile(user);
  } catch (error) {
    setStatus(error?.message || 'Unable to sign in', true);
  } finally {
    setLoading(false);
  }
});

sessionButton.addEventListener('click', () => {
  const session = readSession();
  if (!session?.user) {
    setStatus('No active session found. Sign in first.', true);
    return;
  }
  applyProfile(session.user);
});

const bootSession = readSession();
if (bootSession?.user) {
  usernameInput.value = bootSession.user.username || '';
  applyProfile(bootSession.user);
} else {
  scene.setProfile({ username: 'Guest', metrics: {} });
  setStatus('Sign in to preview live metrics.');
}

window.addEventListener('beforeunload', () => {
  scene.destroy();
});
