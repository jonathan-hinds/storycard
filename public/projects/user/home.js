import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { DeckBuilderScene } from '/public/projects/card-library/DeckBuilderScene.js';
import { PhaseManagerClient } from '/public/phase-manager/index.js';
import { createPhaseManagerElements } from '/public/projects/user/canvasShared.js';

const USER_SESSION_KEY = 'storycard-user-session';
const POLL_INTERVAL_MS = 1500;

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
  constructor({ canvas, interactionTarget, username, onDecks, onFindMatch, onChallengeMode }) {
    this.canvas = canvas;
    this.interactionTarget = interactionTarget;
    this.onDecks = onDecks;
    this.onFindMatch = onFindMatch;
    this.onChallengeMode = onChallengeMode;
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

    this.onPointerUp = this.onPointerUp.bind(this);
    this.onResize = this.onResize.bind(this);
    this.interactionTarget.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);

    this.onResize();
    this.renderer.setAnimationLoop(() => this.renderer.render(this.scene, this.camera));
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
  }

  onResize() {
    const width = Math.max(window.innerWidth, 320);
    const height = Math.max(window.innerHeight, 320);
    this.renderer.setSize(width, height, false);
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
const statusEl = document.getElementById('user-module-status');
const backButton = document.getElementById('user-module-back-button');

let session = loadSession();
if (!session) {
  window.location.replace('/public/projects/user/index.html');
}

let homeScene = null;
let deckBuilderScene = null;
let phaseManager = null;
let matchmakingPollTimer = 0;
let hasRequestedExit = false;
let pendingSavePromise = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message || '';
  statusEl.dataset.error = isError ? 'true' : 'false';
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
  const validity = summary.isValid ? '✅ Deck valid' : '⚠️ Deck invalid';
  const violations = summary.violations.length ? ` — ${summary.violations.join(' ')}` : '';
  setStatus(`${validity} (${summary.deckCardIds.length}/10 cards, ${summary.creatureCount} creatures)${violations}`, !summary.isValid);
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
  setStatus('Saving deck...');
  try {
    pendingSavePromise = persistDeck(summary);
    await pendingSavePromise;
    updateDeckStatus(summary);
    setStatus(`${statusEl.textContent} — Saved.`);
  } catch (error) {
    setStatus(error.message || 'Unable to save deck.', true);
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
  canvas.hidden = false;
}

function showHome() {
  teardownAll();
  overlayEl.hidden = true;
  backButton.hidden = true;
  setStatus('');
  hasRequestedExit = false;

  homeScene = new HomeCanvasScene({
    canvas,
    interactionTarget: stage,
    username: session.user.username,
    onDecks: () => showDecks(),
    onFindMatch: () => startFindMatchFromHome(),
    onChallengeMode: () => startChallengeModeFromHome(),
  });

  pollMatchStatusUntilMatched();
}

async function showDecks() {
  teardownAll();
  overlayEl.hidden = true;
  backButton.hidden = true;
  setStatus('Loading cards...');

  await refreshUserDeck();
  const response = await fetch('/api/projects/cards');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load cards');
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  if (!cards.length) {
    setStatus('No cards found in the catalog.', true);
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
  setStatus('');

  phaseManager = new PhaseManagerClient({
    elements: createPhaseManagerElements({ canvas, overlayEl }),
    options: {
      playerId: session.user.id,
      matchmakingPayload: {
        deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
      },
      cardGameOptions: {
        viewportHeightOffset: 0,
      },
    },
  });
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
    if (homeScene) {
      homeScene.setFindMatchState(searching ? 'searching' : 'idle');
      if (!searching) homeScene.setChallengeModeState('idle');
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
  if (homeScene) homeScene.setFindMatchState('searching');

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
      if (homeScene) homeScene.setFindMatchState('idle');
      stopPolling();
    });
}

function startChallengeModeFromHome() {
  if (!session?.user?.id) return;
  if (homeScene) homeScene.setChallengeModeState('searching');

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
      if (homeScene) homeScene.setChallengeModeState('idle');
      stopPolling();
    });
}

backButton.addEventListener('click', () => {
  requestMatchExit(session.user.id);
  showHome();
});

window.addEventListener('pagehide', () => {
  requestMatchExit(session.user.id);
});

showHome();
