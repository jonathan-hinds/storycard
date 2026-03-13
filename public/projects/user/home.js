import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { DeckBuilderScene } from '/public/projects/card-library/DeckBuilderScene.js';
import { PhaseManagerClient } from '/public/phase-manager/index.js';
import { createPhaseManagerElements } from '/public/projects/user/canvasShared.js';
import { ProfilePanelScene } from '/public/projects/profile-sandbox/src/ProfilePanelScene.js';
import { toProfilePanelMetrics } from '/public/projects/user/profileMetrics.js';

const USER_SESSION_KEY = 'storycard-user-session';
const POLL_INTERVAL_MS = 1500;
const NPC_AVATAR_ASSET_FALLBACKS = [
  '/public/assets/mossling.png',
  '/public/assets/bramblekit.png',
  '/public/assets/cinderling.png',
  '/public/assets/runelet.png',
  '/public/assets/embermote.png',
  '/public/assets/sootboundwelp.png',
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

function loadSession() {
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

function saveSession(session) {
  const serialized = JSON.stringify(session);
  const sessionStorageRef = getSessionStorage();
  if (sessionStorageRef) sessionStorageRef.setItem(USER_SESSION_KEY, serialized);
  const localStorageRef = getLocalStorage();
  if (localStorageRef) localStorageRef.removeItem(USER_SESSION_KEY);
}

class HomeCanvasScene {
  constructor({ canvas, interactionTarget, username, onDecks, onFindMatch, onChallengeMode, onProfile }) {
    this.canvas = canvas;
    this.interactionTarget = interactionTarget;
    this.onDecks = onDecks;
    this.onFindMatch = onFindMatch;
    this.onChallengeMode = onChallengeMode;
    this.onProfile = onProfile;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.hitTargets = [];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x090d17, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-6.5, 6.5, 6.5, -6.5, 0.1, 40);
    this.camera.position.set(0, 0, 10);

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(10.8, 8.2),
      new THREE.MeshBasicMaterial({ color: 0x121a2b })
    );
    this.scene.add(panel);

    this.titleSprite = this.createTextSprite(`Welcome, ${username}`, { fontSize: 76, width: 1800, height: 280 });
    this.titleSprite.scale.set(8.2, 1.4, 1);
    this.titleSprite.position.set(0, 2.5, 0.1);
    this.scene.add(this.titleSprite);

    this.subtitleSprite = this.createTextSprite('Choose an action', { fontSize: 52, width: 1400, height: 220, color: '#b7c7ea' });
    this.subtitleSprite.scale.set(5.8, 0.9, 1);
    this.subtitleSprite.position.set(0, 1.55, 0.1);
    this.scene.add(this.subtitleSprite);

    this.decksButton = this.createButton('Decks', -3.4, -0.4);
    this.matchButton = this.createButton('Find Match', 0, -0.4, { secondary: true });
    this.challengeButton = this.createButton('Challenge Mode', 3.4, -0.4, { secondary: true });
    this.profileButton = this.createButton('Profile', 0, -2.05);

    this.onPointerUp = this.onPointerUp.bind(this);
    this.onResize = this.onResize.bind(this);
    this.interactionTarget.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);

    this.onResize();
    this.renderer.setAnimationLoop(() => this.renderer.render(this.scene, this.camera));
  }

  applyResponsiveLayout() {
    const width = Math.max(window.innerWidth, 320);
    const isMobile = width <= 840;

    if (isMobile) {
      this.titleSprite.scale.set(8.6, 1.2, 1);
      this.titleSprite.position.set(0, 2.7, 0.1);
      this.subtitleSprite.scale.set(6.2, 0.8, 1);
      this.subtitleSprite.position.set(0, 1.8, 0.1);
      this.decksButton.position.set(-2.05, 0.45, 0.2);
      this.matchButton.position.set(2.05, 0.45, 0.2);
      this.challengeButton.position.set(-2.05, -1.2, 0.2);
      this.profileButton.position.set(2.05, -1.2, 0.2);
      return;
    }

    this.titleSprite.scale.set(8.2, 1.4, 1);
    this.titleSprite.position.set(0, 2.5, 0.1);
    this.subtitleSprite.scale.set(5.8, 0.9, 1);
    this.subtitleSprite.position.set(0, 1.55, 0.1);
    this.decksButton.position.set(-3.4, -0.4, 0.2);
    this.matchButton.position.set(0, -0.4, 0.2);
    this.challengeButton.position.set(3.4, -0.4, 0.2);
    this.profileButton.position.set(0, -2.05, 0.2);
  }

  createTextSprite(text, { width = 1200, height = 300, fontSize = 72, color = '#e7eeff' } = {}) {
    const textCanvas = document.createElement('canvas');
    textCanvas.width = width;
    textCanvas.height = height;
    const context = textCanvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    context.font = `700 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2);
    const texture = new THREE.CanvasTexture(textCanvas);
    texture.needsUpdate = true;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  }

  createButton(label, x, y, { secondary = false } = {}) {
    const button = new THREE.Mesh(
      new THREE.PlaneGeometry(3.3, 1.2),
      new THREE.MeshBasicMaterial({ color: secondary ? 0x1c2b49 : 0x334f80 })
    );
    button.position.set(x, y, 0.2);

    const labelSprite = this.createTextSprite(label, { width: 1000, height: 240, fontSize: 70 });
    labelSprite.scale.set(2.8, 0.8, 1);
    labelSprite.position.set(0, 0, 0.1);
    button.add(labelSprite);

    this.scene.add(button);
    this.hitTargets.push(button);
    return button;
  }

  setFindMatchState(state) {
    const nextLabel = state === 'searching' ? 'Searching...' : 'Find Match';
    this.matchButton.clear();
    const labelSprite = this.createTextSprite(nextLabel, { width: 1000, height: 240, fontSize: 70 });
    labelSprite.scale.set(2.8, 0.8, 1);
    labelSprite.position.set(0, 0, 0.1);
    this.matchButton.add(labelSprite);
  }

  setChallengeModeState(state) {
    const nextLabel = state === 'searching' ? 'Loading NPC...' : 'Challenge Mode';
    this.challengeButton.clear();
    const labelSprite = this.createTextSprite(nextLabel, { width: 1000, height: 240, fontSize: 70 });
    labelSprite.scale.set(2.8, 0.8, 1);
    labelSprite.position.set(0, 0, 0.1);
    this.challengeButton.add(labelSprite);
  }

  onPointerUp(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const [hit] = this.raycaster.intersectObjects(this.hitTargets, false);
    if (!hit?.object) return;
    if (hit.object === this.decksButton) this.onDecks();
    if (hit.object === this.matchButton) this.onFindMatch();
    if (hit.object === this.challengeButton) this.onChallengeMode();
    if (hit.object === this.profileButton) this.onProfile();
  }

  onResize() {
    const width = Math.max(window.innerWidth, 320);
    const height = Math.max(window.innerHeight, 320);
    this.renderer.setSize(width, height, false);
    this.applyResponsiveLayout();
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.interactionTarget.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

const stage = document.getElementById('user-module-stage');
const canvas = document.getElementById('user-module-canvas');
const overlayEl = document.getElementById('phase-manager-turn-overlay');
const backButton = document.getElementById('user-module-back-button');

let session = loadSession();
if (!session) {
  window.location.replace('/public/projects/user/index.html');
}

let homeScene = null;
let deckBuilderScene = null;
let phaseManager = null;
let profileScene = null;
let matchmakingPollTimer = 0;
let hasRequestedExit = false;
let hasPlayedBattleCloseout = false;
let pendingSavePromise = null;
let currentMatchRequestMode = null;
let loadedAvatarAssetPaths = null;

function pickNpcAvatarPath(assets, npcId) {
  const sourceAssets = Array.isArray(assets) && assets.length ? assets : NPC_AVATAR_ASSET_FALLBACKS;
  if (!sourceAssets.length) return null;
  const normalizedNpcId = String(npcId || 'npc').trim();
  let hash = 0;
  for (let index = 0; index < normalizedNpcId.length; index += 1) {
    hash = ((hash << 5) - hash + normalizedNpcId.charCodeAt(index)) | 0;
  }
  const selectedIndex = Math.abs(hash) % sourceAssets.length;
  return sourceAssets[selectedIndex];
}

async function loadImageAssetPaths() {
  try {
    const response = await fetch('/api/assets');
    const payload = await response.json();
    if (!response.ok) return NPC_AVATAR_ASSET_FALLBACKS;
    const assets = Array.isArray(payload?.assets)
      ? payload.assets
        .filter((asset) => asset && typeof asset.path === 'string')
        .map((asset) => asset.path)
      : [];
    return assets.length ? assets : NPC_AVATAR_ASSET_FALLBACKS;
  } catch (error) {
    return NPC_AVATAR_ASSET_FALLBACKS;
  }
}

async function updateOpponentProfile(opponentId = null) {
  if (!phaseManager) return;
  const normalizedOpponentId = typeof opponentId === 'string' ? opponentId.trim() : '';
  if (!normalizedOpponentId) {
    phaseManager.setOpponentProfile({ username: 'Opponent', avatarImagePath: null });
    return;
  }

  if (normalizedOpponentId.startsWith('npc-')) {
    if (!loadedAvatarAssetPaths) {
      loadedAvatarAssetPaths = await loadImageAssetPaths();
    }
    phaseManager.setOpponentProfile({
      avatarImagePath: pickNpcAvatarPath(loadedAvatarAssetPaths, normalizedOpponentId),
      username: 'NPC Opponent',
    });
    return;
  }

  try {
    const response = await fetch(`/api/users/${encodeURIComponent(normalizedOpponentId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to fetch user');
    const user = payload?.user || {};
    phaseManager.setOpponentProfile({
      avatarImagePath: user.avatarImagePath || null,
      username: String(user.username || 'Opponent').trim() || 'Opponent',
    });
  } catch (error) {
    phaseManager.setOpponentProfile({ username: 'Opponent', avatarImagePath: null });
  }
}

function stopPolling() {
  if (!matchmakingPollTimer) return;
  window.clearInterval(matchmakingPollTimer);
  matchmakingPollTimer = 0;
}

function ensurePolling() {
  if (matchmakingPollTimer) return;
  matchmakingPollTimer = window.setInterval(() => {
    pollMatchStatusUntilMatched();
  }, POLL_INTERVAL_MS);
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed with status ${response.status}`);
  return data;
}

async function getJson(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed with status ${response.status}`);
  return data;
}

async function refreshUserDeck() {
  const response = await fetch(`/api/users/${encodeURIComponent(session.user.id)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load current deck');
  if (payload?.user) {
    session.user = payload.user;
    saveSession(session);
  }
}

async function persistDeck(summary) {
  const response = await fetch(`/api/users/${encodeURIComponent(session.user.id)}/deck`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      deck: {
        cards: summary.deckCardIds,
        creatureCount: summary.creatureCount,
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to save deck');
  if (payload?.user) {
    session.user = payload.user;
    saveSession(session);
  }
}

function updateDeckStatus(summary) {
  session.user.deck = {
    cards: summary.deckCardIds,
    creatureCount: summary.creatureCount,
    updatedAt: new Date().toISOString(),
  };
  saveSession(session);
}

async function handleSaveDeck() {
  const summary = deckBuilderScene?.getDeckSummary?.();
  if (!summary) return;
  try {
    pendingSavePromise = persistDeck(summary);
    await pendingSavePromise;
    updateDeckStatus(summary);
  } catch (error) {
    // Deck validity and save feedback are now rendered in-canvas by DeckBuilderScene.
  } finally {
    pendingSavePromise = null;
  }
}

async function requestMatchExit(playerId) {
  if (!playerId || hasRequestedExit) return;
  hasRequestedExit = true;

  const payload = JSON.stringify({ playerId });
  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/api/phase-manager/matchmaking/reset', blob);
    return;
  }

  await fetch('/api/phase-manager/matchmaking/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

function playBattleCloseoutTransition({ didPlayerWin = false } = {}) {
  if (hasPlayedBattleCloseout) return;
  hasPlayedBattleCloseout = true;

  const overlay = document.createElement('div');
  overlay.className = 'battle-closeout-overlay';
  overlay.innerHTML = `
    <div class="battle-closeout-center">
      <p class="battle-closeout-label">${didPlayerWin ? 'VICTORY!' : 'DEFEAT!'}</p>
      <p class="battle-closeout-sub">Returning to home…</p>
    </div>
    <div class="battle-closeout-shutter battle-closeout-shutter-top"></div>
    <div class="battle-closeout-shutter battle-closeout-shutter-bottom"></div>
  `;
  document.body.appendChild(overlay);

  window.setTimeout(() => {
    overlay.classList.add('is-active');
  }, 30);

  window.setTimeout(() => {
    overlay.remove();
    showHome();
  }, 2200);
}

function teardownAll() {
  stopPolling();
  if (homeScene) {
    homeScene.destroy();
    homeScene = null;
  }
  if (deckBuilderScene) {
    deckBuilderScene.destroy();
    deckBuilderScene = null;
  }
  if (phaseManager) {
    phaseManager.destroy();
    phaseManager = null;
  }
  if (profileScene) {
    profileScene.dispose();
    profileScene = null;
  }
  canvas.hidden = false;
}

function showHome() {
  teardownAll();
  overlayEl.hidden = true;
  backButton.hidden = true;
  hasRequestedExit = false;
  currentMatchRequestMode = null;

  homeScene = new HomeCanvasScene({
    canvas,
    interactionTarget: stage,
    username: session.user.username,
    onDecks: () => showDecks(),
    onFindMatch: () => startFindMatchFromHome(),
    onChallengeMode: () => startChallengeModeFromHome(),
    onProfile: () => showProfile(),
  });

  pollMatchStatusUntilMatched();
}

async function showProfile() {
  teardownAll();
  overlayEl.hidden = true;
  backButton.hidden = false;

  await refreshUserDeck();

  profileScene = new ProfilePanelScene({
    canvas,
    initialProfile: {
      username: session.user.username,
      avatarImagePath: session.user.avatarImagePath || null,
      metrics: toProfilePanelMetrics(session.user?.metrics),
    },
    onAvatarSave: async (avatarImagePath) => {
      const response = await fetch(`/api/users/${encodeURIComponent(session.user.id)}/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarImagePath }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to save avatar');
      if (payload?.user) {
        session.user = payload.user;
        saveSession(session);
        profileScene.setProfile({
          username: session.user.username,
          avatarImagePath: session.user.avatarImagePath || null,
          metrics: toProfilePanelMetrics(session.user?.metrics),
        });
      }
    },
  });

  const assetsResponse = await fetch('/api/assets');
  const assetsPayload = await assetsResponse.json();
  if (!assetsResponse.ok) throw new Error(assetsPayload.error || 'Unable to load assets');
  await profileScene.setAssets(assetsPayload.assets || []);
}

async function showDecks() {
  teardownAll();
  overlayEl.hidden = true;
  backButton.hidden = true;

  await refreshUserDeck();
  const response = await fetch('/api/projects/cards');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load cards');
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  if (!cards.length) {
    return;
  }

  deckBuilderScene = new DeckBuilderScene({
    canvas,
    interactionTarget: stage,
    onDeckChange: updateDeckStatus,
    onSave: handleSaveDeck,
    onBack: async () => {
      if (pendingSavePromise) {
        try {
          await pendingSavePromise;
        } catch (error) {
          // Let the user still navigate back.
        }
      }
      showHome();
    },
    filterPanelControls: {
      width: 6.5,
      height: 0.96,
      x: 0,
      y: 0,
      fontScale: 1,
      opacity: 0.15,
      checkboxScale: 1.8,
    },
  });

  const initialDeckCardIds = Array.isArray(session.user.deck?.cards)
    ? [...session.user.deck.cards]
    : [];
  deckBuilderScene.setCards(cards);
  deckBuilderScene.setDeckCardIds(initialDeckCardIds);
}

function showMatch() {
  teardownAll();
  overlayEl.hidden = false;
  backButton.hidden = false;
  hasPlayedBattleCloseout = false;

  phaseManager = new PhaseManagerClient({
    elements: createPhaseManagerElements({ canvas, overlayEl }),
    options: {
      playerId: session.user.id,
      matchmakingPayload: {
        deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
      },
      onMatchComplete: ({ outcome } = {}) => {
        requestMatchExit(session.user.id);
        playBattleCloseoutTransition({ didPlayerWin: Boolean(outcome?.didPlayerWin) });
      },
      onMatchmakingStatus: ({ status } = {}) => {
        if (status?.status === 'matched') {
          updateOpponentProfile(status.opponentId);
          return;
        }
        updateOpponentProfile(null);
      },
      cardGameOptions: {
        viewportHeightOffset: 0,
      },
    },
  });
  phaseManager.setPlayerProfile({
    username: String(session.user.username || 'You').trim() || 'You',
    avatarImagePath: session.user.avatarImagePath || null,
  });
  phaseManager.setOpponentProfile({ username: 'Opponent', avatarImagePath: null });
  phaseManager.start();
}

async function pollMatchStatusUntilMatched() {
  if (!session?.user?.id) return;
  try {
    const status = await getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(session.user.id)}`);
    if (status?.status === 'matched') {
      stopPolling();
      showMatch();
      return;
    }
    const searching = status?.status === 'searching';
    if (!searching) {
      currentMatchRequestMode = null;
    }
    if (homeScene) {
      const isChallengeSearch = searching && currentMatchRequestMode === 'challenge';
      const isPvpSearch = searching && currentMatchRequestMode !== 'challenge';
      homeScene.setFindMatchState(isPvpSearch ? 'searching' : 'idle');
      homeScene.setChallengeModeState(isChallengeSearch ? 'searching' : 'idle');
    }
  } catch (error) {
    stopPolling();
    if (homeScene) {
      homeScene.setFindMatchState('idle');
      homeScene.setChallengeModeState('idle');
    }
  }
}

function startFindMatchFromHome() {
  if (!session?.user?.id) return;
  currentMatchRequestMode = 'pvp';
  if (homeScene) {
    homeScene.setFindMatchState('searching');
    homeScene.setChallengeModeState('idle');
  }

  postJson('/api/phase-manager/matchmaking/find', {
    playerId: session.user.id,
    deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
  })
    .then((status) => {
      if (status?.status === 'matched') {
        showMatch();
        return;
      }
      ensurePolling();
      pollMatchStatusUntilMatched();
    })
    .catch(() => {
      currentMatchRequestMode = null;
      if (homeScene) homeScene.setFindMatchState('idle');
      stopPolling();
    });
}

function startChallengeModeFromHome() {
  if (!session?.user?.id) return;
  currentMatchRequestMode = 'challenge';
  if (homeScene) {
    homeScene.setChallengeModeState('searching');
    homeScene.setFindMatchState('idle');
  }

  postJson('/api/phase-manager/matchmaking/find', {
    playerId: session.user.id,
    deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
    mode: 'challenge',
    opponentType: 'npc',
    npcDeck: 'random',
  })
    .then((status) => {
      if (status?.status === 'matched') {
        showMatch();
        return;
      }
      ensurePolling();
      pollMatchStatusUntilMatched();
    })
    .catch(() => {
      currentMatchRequestMode = null;
      if (homeScene) homeScene.setChallengeModeState('idle');
      stopPolling();
    });
}

backButton.addEventListener('click', () => {
  if (phaseManager) requestMatchExit(session.user.id);
  showHome();
});

window.addEventListener('pagehide', () => {
  requestMatchExit(session.user.id);
});

showHome();
