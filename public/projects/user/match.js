import { PhaseManagerClient } from '/public/phase-manager/index.js';
import { createPhaseManagerElements } from '/public/projects/user/canvasShared.js';

const USER_SESSION_KEY = 'storycard-user-session';

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
const backButton = document.getElementById('user-match-back-button');
let hasRequestedExit = false;
let hasPlayedBattleCloseout = false;

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
    window.location.href = '/public/projects/user/home.html';
  }, 2200);
}

function loadSession() {
  try {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();
    const raw = sessionStorageRef?.getItem(USER_SESSION_KEY) || localStorageRef?.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    if (sessionStorageRef) {
      sessionStorageRef.setItem(USER_SESSION_KEY, raw);
    }
    if (localStorageRef) {
      localStorageRef.removeItem(USER_SESSION_KEY);
    }
    return parsed;
  } catch (error) {
    return null;
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

const session = loadSession();
if (!session) {
  window.location.replace('/public/projects/user/index.html');
} else {
  const playerId = session.user.id;
  const phaseManager = new PhaseManagerClient({
    elements: createPhaseManagerElements({
      canvas: document.getElementById('phase-manager-canvas'),
      overlayEl: document.getElementById('phase-manager-turn-overlay'),
    }),
    options: {
      playerId,
      matchmakingPayload: {
        deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
      },
      onMatchComplete: ({ outcome } = {}) => {
        requestMatchExit(playerId);
        playBattleCloseoutTransition({ didPlayerWin: Boolean(outcome?.didPlayerWin) });
      },
      cardGameOptions: {
        viewportHeightOffset: 0,
      },
    },
  });

  phaseManager.start();

  const shouldAutostart = new URLSearchParams(window.location.search).get('autostart') === '1';
  if (shouldAutostart) {
    phaseManager.beginMatchmaking();
  }

  const exitToHome = () => {
    requestMatchExit(playerId);
    window.location.href = '/public/projects/user/home.html';
  };

  backButton?.addEventListener('click', exitToHome);
  window.addEventListener('pagehide', () => {
    requestMatchExit(playerId);
  });
}
