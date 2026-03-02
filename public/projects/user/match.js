import { PhaseManagerClient } from '/public/phase-manager/index.js';

const USER_SESSION_KEY = 'storycard-user-session';

function loadSession() {
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
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

const session = loadSession();
if (!session) {
  window.location.replace('/public/projects/user/index.html');
} else {
  const phaseManager = new PhaseManagerClient({
    elements: createPhaseManagerElements(),
    options: {
      playerId: session.user.id,
      matchmakingPayload: {
        deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
      },
    },
  });

  phaseManager.start();

  const shouldAutostart = new URLSearchParams(window.location.search).get('autostart') === '1';
  if (shouldAutostart) {
    phaseManager.beginMatchmaking();
  }
}
