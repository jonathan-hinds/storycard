import { PhaseManagerClient } from '/public/phase-manager/index.js';
import { createPhaseManagerElements } from '/public/projects/user/canvasShared.js';

const USER_SESSION_KEY = 'storycard-user-session';
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
const backButton = document.getElementById('user-match-back-button');
const playerAvatarEl = document.getElementById('match-player-avatar');
const opponentAvatarEl = document.getElementById('match-opponent-avatar');
const playerNameEl = document.getElementById('match-player-name');
const opponentNameEl = document.getElementById('match-opponent-name');
let hasRequestedExit = false;
let hasPlayedBattleCloseout = false;

function setAvatarElement(el, { avatarImagePath = null, username = '' } = {}) {
  if (!el) return;
  const normalizedName = String(username || '').trim();
  const glyph = normalizedName.charAt(0).toUpperCase() || '?';
  el.style.backgroundImage = avatarImagePath ? `url(${avatarImagePath})` : 'none';
  el.textContent = avatarImagePath ? '' : glyph;
}

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
  const playerName = String(session.user.username || 'You').trim() || 'You';
  let loadedAvatarAssetPaths = null;

  playerNameEl.textContent = playerName;
  setAvatarElement(playerAvatarEl, {
    avatarImagePath: session.user.avatarImagePath || null,
    username: playerName,
  });
  setAvatarElement(opponentAvatarEl, { username: 'Opponent' });
  opponentNameEl.textContent = 'Opponent';

  const updateOpponentProfile = async ({ opponentId = null } = {}) => {
    const normalizedOpponentId = typeof opponentId === 'string' ? opponentId.trim() : '';
    if (!normalizedOpponentId) {
      opponentNameEl.textContent = 'Opponent';
      setAvatarElement(opponentAvatarEl, { username: 'Opponent' });
      return;
    }

    if (normalizedOpponentId.startsWith('npc-')) {
      if (!loadedAvatarAssetPaths) {
        loadedAvatarAssetPaths = await loadImageAssetPaths();
      }
      opponentNameEl.textContent = 'NPC Opponent';
      setAvatarElement(opponentAvatarEl, {
        avatarImagePath: pickNpcAvatarPath(loadedAvatarAssetPaths, normalizedOpponentId),
        username: 'NPC',
      });
      return;
    }

    try {
      const response = await fetch(`/api/users/${encodeURIComponent(normalizedOpponentId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to fetch user');
      const user = payload?.user || {};
      const username = String(user.username || 'Opponent').trim() || 'Opponent';
      opponentNameEl.textContent = username;
      setAvatarElement(opponentAvatarEl, {
        avatarImagePath: user.avatarImagePath || null,
        username,
      });
    } catch (error) {
      opponentNameEl.textContent = 'Opponent';
      setAvatarElement(opponentAvatarEl, {
        username: 'Opponent',
      });
    }
  };

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
      onMatchmakingStatus: ({ status } = {}) => {
        if (status?.status === 'matched') {
          updateOpponentProfile({ opponentId: status.opponentId });
          return;
        }
        updateOpponentProfile({ opponentId: null });
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
