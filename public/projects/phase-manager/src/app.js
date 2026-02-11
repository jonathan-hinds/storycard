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
let matchmakingPollTimer = 0;
let stateSyncInFlight = false;

function createTabPlayerId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `player-${window.crypto.randomUUID().slice(0, 8)}`;
  }
  return `player-${Math.random().toString(36).slice(2, 10)}`;
}

const playerId = createTabPlayerId();

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
  if (!client || !match) return { hand: [], board: [] };

  const allPlayerCards = client.cards
    .filter((card) => card.userData.owner === PLAYER_SIDE)
    .map((card) => ({
      id: card.userData.cardId,
      color: card.userData.mesh.material.color.getHex(),
      zone: card.userData.zone,
      slotIndex: card.userData.slotIndex,
    }));

  const hand = allPlayerCards
    .filter((card) => card.zone === CARD_ZONE_TYPES.HAND)
    .map(({ id, color }) => ({ id, color }));

  const board = allPlayerCards
    .filter((card) => card.zone === CARD_ZONE_TYPES.BOARD)
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map(({ id, color }) => ({ id, color }));

  return { hand, board };
}

function setTurnLockState() {
  const isPlayerTurn = Boolean(match) && match.turn === PLAYER_SIDE;
  endTurnBtn.disabled = !match || !isPlayerTurn;
  canvas.style.pointerEvents = isPlayerTurn ? 'auto' : 'none';

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
      options: {
        onCardStateCommitted: syncMatchStateAfterCardCommit,
      },
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

async function syncMatchStateAfterCardCommit() {
  if (!match || match.turn !== PLAYER_SIDE || stateSyncInFlight) return;

  const nextState = syncPlayerStateFromClient();
  stateSyncInFlight = true;
  try {
    const status = await postJson('/api/phase-manager/match/sync-state', {
      playerId,
      hand: nextState.hand,
      board: nextState.board,
    });
    applyMatchmakingStatus(status);
  } catch (error) {
    statusEl.textContent = `Card sync error: ${error.message}`;
  } finally {
    stateSyncInFlight = false;
  }
}

function applyMatchmakingStatus(status) {
  updateQueueSummary(status);

  if (status.status === 'matched') {
    matchmakingBtn.disabled = true;
    matchmakingBtn.textContent = 'Match Found';

    const nextMatch = status.matchState || null;
    const nextSerialized = JSON.stringify(nextMatch);
    const currentSerialized = JSON.stringify(match);
    if (nextSerialized !== currentSerialized) {
      match = nextMatch;
      renderMatch();
    } else {
      setTurnLockState();
      updateSummaryPanels();
    }
    return;
  }

  match = null;
  if (client) {
    client.destroy();
    client = null;
  }

  if (status.status === 'searching') {
    statusEl.textContent = 'Looking for match... Waiting for another player to queue.';
    matchmakingBtn.disabled = true;
    matchmakingBtn.textContent = 'Searching...';
    setTurnLockState();
    updateSummaryPanels();
    return;
  }

  matchmakingBtn.disabled = false;
  matchmakingBtn.textContent = 'Find Match';
  renderMatch();
}

async function pollMatchmakingStatus() {
  try {
    const status = await getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(playerId)}`);
    applyMatchmakingStatus(status);
  } catch (error) {
    statusEl.textContent = `Matchmaking status error: ${error.message}`;
  }
}

function beginMatchmaking() {
  if (match) return;

  postJson('/api/phase-manager/matchmaking/find', { playerId })
    .then((status) => {
      applyMatchmakingStatus(status);
      if (!matchmakingPollTimer) {
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

  const nextState = syncPlayerStateFromClient();
  endTurnBtn.disabled = true;

  postJson('/api/phase-manager/match/end-turn', {
    playerId,
    hand: nextState.hand,
    board: nextState.board,
  })
    .then((status) => {
      applyMatchmakingStatus(status);
    })
    .catch((error) => {
      statusEl.textContent = `End turn error: ${error.message}`;
      setTurnLockState();
    });
}

function resetMatch() {
  stopMatchmakingPolling();

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
      matchmakingPollTimer = window.setInterval(pollMatchmakingStatus, 1200);
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
matchmakingPollTimer = window.setInterval(pollMatchmakingStatus, 1200);
pollMatchmakingStatus();
