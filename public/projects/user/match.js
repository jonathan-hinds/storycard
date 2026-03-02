import { PhaseManagerClient } from '/public/phase-manager/index.js';

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

function createHiddenButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.hidden = true;
  return button;
}

function createHiddenOutput() {
  const output = document.createElement('output');
  output.hidden = true;
  return output;
}

function createHiddenInput(type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  input.hidden = true;
  return input;
}

function createPhaseManagerElements() {
  return {
    canvas: document.getElementById('phase-manager-canvas'),
    overlayEl: document.getElementById('phase-manager-turn-overlay'),
    matchmakingBtn: createHiddenButton(),
    readyBtn: createHiddenButton(),
    resetBtn: createHiddenButton(),
    statusEl: document.createElement('p'),
    matchLabelEl: document.createElement('p'),
    playerSummaryEl: document.createElement('p'),
    opponentSummaryEl: document.createElement('p'),
    queueSummaryEl: document.createElement('p'),
    badgeSlotsVisibleInput: createHiddenInput('checkbox'),
    badgeSlotsCountInput: createHiddenInput('range'),
    badgeSlotsCountNumberInput: createHiddenInput('number'),
    badgeSlotsCountValueEl: createHiddenOutput(),
    badgeSlotsXInput: createHiddenInput('range'),
    badgeSlotsXNumberInput: createHiddenInput('number'),
    badgeSlotsXValueEl: createHiddenOutput(),
    badgeSlotsYInput: createHiddenInput('range'),
    badgeSlotsYNumberInput: createHiddenInput('number'),
    badgeSlotsYValueEl: createHiddenOutput(),
    badgeSlotsZInput: createHiddenInput('range'),
    badgeSlotsZNumberInput: createHiddenInput('number'),
    badgeSlotsZValueEl: createHiddenOutput(),
    badgeSlotsGapInput: createHiddenInput('range'),
    badgeSlotsGapNumberInput: createHiddenInput('number'),
    badgeSlotsGapValueEl: createHiddenOutput(),
    badgeSlotsSizeInput: createHiddenInput('range'),
    badgeSlotsSizeNumberInput: createHiddenInput('number'),
    badgeSlotsSizeValueEl: createHiddenOutput(),
    badgeSlotsBevelInput: createHiddenInput('range'),
    badgeSlotsBevelNumberInput: createHiddenInput('number'),
    badgeSlotsBevelValueEl: createHiddenOutput(),
    badgeSlotsThicknessInput: createHiddenInput('range'),
    badgeSlotsThicknessNumberInput: createHiddenInput('number'),
    badgeSlotsThicknessValueEl: createHiddenOutput(),
    layoutExportBtn: createHiddenButton(),
    layoutExportOutputEl: createHiddenOutput(),
  };
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
    elements: createPhaseManagerElements(),
    options: {
      playerId,
      matchmakingPayload: {
        deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
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
