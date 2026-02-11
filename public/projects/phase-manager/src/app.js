import { CardGameClient, CARD_ZONE_TYPES, DEFAULT_ZONE_FRAMEWORK } from '/public/card-game/index.js';

const canvas = document.getElementById('phase-manager-canvas');
const statusEl = document.getElementById('phase-manager-status');
const matchmakingBtn = document.getElementById('phase-manager-matchmaking');
const endTurnBtn = document.getElementById('phase-manager-end-turn');
const resetBtn = document.getElementById('phase-manager-reset');
const overlayEl = document.getElementById('phase-manager-turn-overlay');
const matchLabelEl = document.getElementById('phase-manager-match-label');
const playerSummaryEl = document.getElementById('phase-manager-player-summary');
const opponentSummaryEl = document.getElementById('phase-manager-opponent-summary');

const PLAYER_SIDE = 'player';
const OPPONENT_SIDE = 'opponent';
const BOARD_SLOTS_PER_SIDE = 3;
const PLAYER_ID_KEY = 'phase-manager-player-id';

let client = null;
let match = null;
let pollTimer = 0;
let isMatchmaking = false;

function getOrCreatePlayerId() {
  const existing = window.localStorage.getItem(PLAYER_ID_KEY);
  if (existing) return existing;
  const nextId = `player-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(PLAYER_ID_KEY, nextId);
  return nextId;
}

const playerId = getOrCreatePlayerId();

async function apiRequest(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

function getBoardSlotLayout() {
  return [
    { x: -1.05, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.BOARD },
    { x: 1.05, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.BOARD },
    { x: 3.15, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.BOARD },
    { x: -1.05, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.BOARD },
    { x: 1.05, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.BOARD },
    { x: 3.15, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.BOARD },
  ];
}

function getDeckSlotLayout() {
  return [
    { x: -3.15, z: -1.3, side: OPPONENT_SIDE, zone: CARD_ZONE_TYPES.DECK },
    { x: -3.15, z: 1.6, side: PLAYER_SIDE, zone: CARD_ZONE_TYPES.DECK },
  ];
}

function getHiddenZoneLayout() {
  const hiddenZones = [CARD_ZONE_TYPES.DISCARD, CARD_ZONE_TYPES.EXILE, CARD_ZONE_TYPES.STAGING, CARD_ZONE_TYPES.STACK, CARD_ZONE_TYPES.RESOLVING];
  return [
    ...hiddenZones.map((zone) => ({ side: PLAYER_SIDE, zone })),
    ...hiddenZones.map((zone) => ({ side: OPPONENT_SIDE, zone })),
  ];
}

function buildTemplateFromMatch(currentMatch) {
  const initialCards = [];

  currentMatch.players.opponent.board.forEach((card, index) => {
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: OPPONENT_SIDE,
      zone: CARD_ZONE_TYPES.BOARD,
      slotIndex: index,
    });
  });

  currentMatch.players.player.board.forEach((card, index) => {
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: PLAYER_SIDE,
      zone: CARD_ZONE_TYPES.BOARD,
      slotIndex: BOARD_SLOTS_PER_SIDE + index,
    });
  });

  currentMatch.players.player.hand.forEach((card) => {
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: PLAYER_SIDE,
      zone: CARD_ZONE_TYPES.HAND,
    });
  });

  return {
    playerSide: PLAYER_SIDE,
    zoneFramework: DEFAULT_ZONE_FRAMEWORK,
    boardSlotLayout: getBoardSlotLayout(),
    deckSlotLayout: getDeckSlotLayout(),
    hiddenZoneLayout: getHiddenZoneLayout(),
    initialCards,
  };
}

function getPlayerStateFromClient() {
  if (!client || !match) {
    return { hand: [], board: [] };
  }

  const cards = client.cards
    .filter((card) => card.userData.owner === PLAYER_SIDE)
    .map((card) => ({
      id: card.userData.cardId,
      color: card.userData.mesh.material.color.getHex(),
      zone: card.userData.zone,
      slotIndex: card.userData.slotIndex,
    }));

  return {
    hand: cards
      .filter((card) => card.zone === CARD_ZONE_TYPES.HAND)
      .map(({ id, color }) => ({ id, color })),
    board: cards
      .filter((card) => card.zone === CARD_ZONE_TYPES.BOARD)
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map(({ id, color }) => ({ id, color })),
  };
}

function setTurnLockState() {
  const isPlayerTurn = Boolean(match) && match.isPlayerTurn;
  endTurnBtn.disabled = !match || !isPlayerTurn;

  if (isMatchmaking && !match) {
    overlayEl.hidden = false;
    overlayEl.textContent = 'Looking for an opponent…';
    return;
  }

  if (!match) {
    overlayEl.hidden = false;
    overlayEl.textContent = 'Start matchmaking to begin a match.';
    return;
  }

  overlayEl.hidden = isPlayerTurn;
  overlayEl.textContent = isPlayerTurn ? '' : 'Opponent turn in progress…';
}

function updateSummaryPanels() {
  if (!match) {
    matchLabelEl.textContent = isMatchmaking ? 'Searching for match…' : 'No active match';
    playerSummaryEl.textContent = 'Player: waiting for matchmaking';
    opponentSummaryEl.textContent = 'Opponent: waiting for matchmaking';
    return;
  }

  const player = match.players.player;
  const opponent = match.players.opponent;
  matchLabelEl.textContent = `${match.id} • ${match.isPlayerTurn ? 'Your turn' : 'Opponent turn'}`;
  playerSummaryEl.textContent = `Player — hand: ${player.hand.length}, board: ${player.board.length}`;
  opponentSummaryEl.textContent = `Opponent — hand: ${opponent.handCount}, board: ${opponent.board.length}`;
}

function renderMatch() {
  if (!match) {
    statusEl.textContent = isMatchmaking
      ? 'Searching for an opponent…'
      : 'Click matchmaking to create a 1v1 turn test.';
    setTurnLockState();
    updateSummaryPanels();
    return;
  }

  const template = buildTemplateFromMatch(match);
  if (!client) {
    client = new CardGameClient({
      canvas,
      statusElement: statusEl,
      template,
    });
  } else {
    client.template = template;
    client.resetDemo();
  }

  statusEl.textContent = match.isPlayerTurn
    ? 'Your turn. Drag cards from your hand to your board, then click End Turn.'
    : 'Opponent turn. Waiting for remote action…';

  setTurnLockState();
  updateSummaryPanels();
}

async function refreshMatchState() {
  if (!match) return;
  try {
    const payload = await apiRequest(`/api/phase-manager/matches/${match.id}?playerId=${encodeURIComponent(playerId)}`);
    match = payload.match;
    isMatchmaking = false;
    renderMatch();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function pollState() {
  window.clearTimeout(pollTimer);

  try {
    if (!match && isMatchmaking) {
      const payload = await apiRequest(`/api/phase-manager/matchmaking/${encodeURIComponent(playerId)}`);
      if (payload.status === 'matched') {
        match = payload.match;
        isMatchmaking = false;
        renderMatch();
      } else {
        setTurnLockState();
        updateSummaryPanels();
      }
    } else if (match) {
      await refreshMatchState();
    }
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    pollTimer = window.setTimeout(pollState, 1000);
  }
}

async function beginMatchmaking() {
  window.clearTimeout(pollTimer);
  isMatchmaking = true;
  match = null;
  renderMatch();

  try {
    const payload = await apiRequest('/api/phase-manager/matchmaking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });

    if (payload.status === 'matched') {
      match = payload.match;
      isMatchmaking = false;
    }
    renderMatch();
  } catch (error) {
    isMatchmaking = false;
    statusEl.textContent = error.message;
    renderMatch();
  } finally {
    pollState();
  }
}

async function endTurn() {
  if (!match || !match.isPlayerTurn) return;

  try {
    const payload = await apiRequest(`/api/phase-manager/matches/${match.id}/end-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId,
        playerState: getPlayerStateFromClient(),
      }),
    });
    match = payload.match;
    renderMatch();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function resetMatch() {
  window.clearTimeout(pollTimer);
  try {
    await apiRequest('/api/phase-manager/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
  } catch (_error) {
    // ignore reset errors
  }

  isMatchmaking = false;
  match = null;
  if (client) {
    client.destroy();
    client = null;
  }
  renderMatch();
}

matchmakingBtn.addEventListener('click', beginMatchmaking);
endTurnBtn.addEventListener('click', endTurn);
resetBtn.addEventListener('click', resetMatch);

renderMatch();
pollState();
