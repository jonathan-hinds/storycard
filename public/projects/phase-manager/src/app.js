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
const queueSummaryEl = document.getElementById('phase-manager-queue-summary');

const PLAYER_SIDE = 'player';
const OPPONENT_SIDE = 'opponent';
const BOARD_SLOTS_PER_SIDE = 3;

let client = null;
let match = null;
let opponentTurnTimer = 0;
let matchmakingPollTimer = 0;

const SESSION_PLAYER_ID_KEY = 'phase-manager-player-id';

function getSessionPlayerId() {
  const existing = window.sessionStorage.getItem(SESSION_PLAYER_ID_KEY);
  if (existing) {
    return existing;
  }
  const nextId = `player-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(SESSION_PLAYER_ID_KEY, nextId);
  return nextId;
}

const playerId = getSessionPlayerId();

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

const colorPool = [0x5f8dff, 0x8f6cff, 0x2dc6ad, 0xf28a65, 0xf1c965, 0xe76fb9, 0x4ecdc4, 0xff6b6b, 0xc7f464, 0xffa94d];

function randomCard(prefix, index) {
  const id = `${prefix}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
  const color = colorPool[Math.floor(Math.random() * colorPool.length)];
  return { id, color };
}

function createNewMatch({ matchId, isYourTurn }) {
  return {
    id: matchId,
    turn: isYourTurn ? PLAYER_SIDE : OPPONENT_SIDE,
    players: {
      [PLAYER_SIDE]: {
        hand: Array.from({ length: 3 }, (_, index) => randomCard('p', index)),
        board: [],
      },
      [OPPONENT_SIDE]: {
        hand: Array.from({ length: 3 }, (_, index) => randomCard('o', index)),
        board: [],
      },
    },
  };
}

function stopMatchmakingPolling() {
  if (matchmakingPollTimer) {
    window.clearInterval(matchmakingPollTimer);
    matchmakingPollTimer = 0;
  }
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

  currentMatch.players[OPPONENT_SIDE].board.forEach((card, index) => {
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: OPPONENT_SIDE,
      zone: CARD_ZONE_TYPES.BOARD,
      slotIndex: index,
    });
  });

  currentMatch.players[PLAYER_SIDE].board.forEach((card, index) => {
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: PLAYER_SIDE,
      zone: CARD_ZONE_TYPES.BOARD,
      slotIndex: BOARD_SLOTS_PER_SIDE + index,
    });
  });

  currentMatch.players[PLAYER_SIDE].hand.forEach((card) => {
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

function syncPlayerStateFromClient() {
  if (!client || !match) return;

  const allPlayerCards = client.cards
    .filter((card) => card.userData.owner === PLAYER_SIDE)
    .map((card) => ({
      id: card.userData.cardId,
      color: card.userData.mesh.material.color.getHex(),
      zone: card.userData.zone,
      slotIndex: card.userData.slotIndex,
    }));

  match.players[PLAYER_SIDE].hand = allPlayerCards
    .filter((card) => card.zone === CARD_ZONE_TYPES.HAND)
    .map(({ id, color }) => ({ id, color }));

  match.players[PLAYER_SIDE].board = allPlayerCards
    .filter((card) => card.zone === CARD_ZONE_TYPES.BOARD)
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map(({ id, color }) => ({ id, color }));
}

function setTurnLockState() {
  const isPlayerTurn = Boolean(match) && match.turn === PLAYER_SIDE;
  endTurnBtn.disabled = !match || !isPlayerTurn;

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
    queueSummaryEl.textContent = 'Queue: idle';
  }

  if (!match) {
    matchLabelEl.textContent = 'No active match';
    playerSummaryEl.textContent = 'Player: waiting for matchmaking';
    opponentSummaryEl.textContent = 'Opponent: waiting for matchmaking';
    return;
  }

  const player = match.players[PLAYER_SIDE];
  const opponent = match.players[OPPONENT_SIDE];
  matchLabelEl.textContent = `${match.id} • ${match.turn === PLAYER_SIDE ? 'Your turn' : 'Opponent turn'}`;
  playerSummaryEl.textContent = `Player — hand: ${player.hand.length}, board: ${player.board.length}`;
  opponentSummaryEl.textContent = `Opponent — hand: ${opponent.hand.length}, board: ${opponent.board.length}`;
}

function updateQueueSummary(status) {
  if (!status) {
    queueSummaryEl.textContent = 'Queue: idle';
    return;
  }

  if (status.status === 'searching') {
    const positionText = status.queuePosition ? ` (you are #${status.queuePosition})` : '';
    queueSummaryEl.textContent = `Queue: ${status.queueCount} waiting${positionText}`;
    return;
  }

  if (status.status === 'matched') {
    queueSummaryEl.textContent = `Queue: matched in ${status.matchId}`;
    return;
  }

  queueSummaryEl.textContent = `Queue: ${status.queueCount ?? 0} waiting`;
}

function renderMatch() {
  if (!match) {
    statusEl.textContent = 'Click matchmaking to create a 1v1 turn test.';
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

  statusEl.textContent = match.turn === PLAYER_SIDE
    ? 'Your turn. Drag cards from your hand to your board, then click End Turn.'
    : 'Opponent turn. Waiting for remote action…';

  setTurnLockState();
  updateSummaryPanels();
}

function applyMatchmakingStatus(status) {
  updateQueueSummary(status);

  if (status.status === 'matched') {
    stopMatchmakingPolling();
    matchmakingBtn.disabled = true;
    matchmakingBtn.textContent = 'Match Found';

    if (!match || match.id !== status.matchId) {
      window.clearTimeout(opponentTurnTimer);
      match = createNewMatch({ matchId: status.matchId, isYourTurn: Boolean(status.isYourTurn) });
      renderMatch();
      if (!status.isYourTurn) {
        opponentTurnTimer = window.setTimeout(runOpponentTurn, 900);
      }
    }
    return;
  }

  if (status.status === 'searching') {
    statusEl.textContent = 'Looking for match... Waiting for another player to queue.';
    matchmakingBtn.disabled = true;
    matchmakingBtn.textContent = 'Searching...';
    setTurnLockState();
    return;
  }

  matchmakingBtn.disabled = false;
  matchmakingBtn.textContent = 'Find Match';
}

async function pollMatchmakingStatus() {
  try {
    const status = await getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(playerId)}`);
    applyMatchmakingStatus(status);
  } catch (error) {
    statusEl.textContent = `Matchmaking status error: ${error.message}`;
  }
}

function runOpponentTurn() {
  if (!match || match.turn !== OPPONENT_SIDE) return;

  const opponent = match.players[OPPONENT_SIDE];
  if (opponent.hand.length > 0 && opponent.board.length < BOARD_SLOTS_PER_SIDE) {
    const nextCard = opponent.hand.shift();
    opponent.board.push(nextCard);
  }

  match.turn = PLAYER_SIDE;
  renderMatch();
}

function beginMatchmaking() {
  if (match) return;

  stopMatchmakingPolling();
  window.clearTimeout(opponentTurnTimer);

  postJson('/api/phase-manager/matchmaking/find', { playerId })
    .then((status) => {
      applyMatchmakingStatus(status);
      if (status.status !== 'matched') {
        matchmakingPollTimer = window.setInterval(pollMatchmakingStatus, 1200);
      }
    })
    .catch((error) => {
      statusEl.textContent = `Matchmaking failed: ${error.message}`;
      matchmakingBtn.disabled = false;
      matchmakingBtn.textContent = 'Find Match';
    });
}

function endTurn() {
  if (!match || match.turn !== PLAYER_SIDE) return;

  syncPlayerStateFromClient();
  match.turn = OPPONENT_SIDE;
  renderMatch();

  opponentTurnTimer = window.setTimeout(runOpponentTurn, 900);
}

function resetMatch() {
  stopMatchmakingPolling();
  window.clearTimeout(opponentTurnTimer);

  match = null;
  if (client) {
    client.destroy();
    client = null;
  }

  postJson('/api/phase-manager/matchmaking/reset', { playerId })
    .then((status) => {
      updateQueueSummary(status);
      matchmakingBtn.disabled = false;
      matchmakingBtn.textContent = 'Find Match';
    })
    .catch((error) => {
      statusEl.textContent = `Reset error: ${error.message}`;
    });

  renderMatch();
}

matchmakingBtn.addEventListener('click', beginMatchmaking);
endTurnBtn.addEventListener('click', endTurn);
resetBtn.addEventListener('click', resetMatch);

renderMatch();
pollMatchmakingStatus();
