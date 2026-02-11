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

let client = null;
let match = null;
let opponentTurnTimer = 0;

const colorPool = [0x5f8dff, 0x8f6cff, 0x2dc6ad, 0xf28a65, 0xf1c965, 0xe76fb9, 0x4ecdc4, 0xff6b6b, 0xc7f464, 0xffa94d];

function randomCard(prefix, index) {
  const id = `${prefix}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
  const color = colorPool[Math.floor(Math.random() * colorPool.length)];
  return { id, color };
}

function createNewMatch() {
  return {
    id: `match-${Math.random().toString(36).slice(2, 8)}`,
    turn: PLAYER_SIDE,
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
  window.clearTimeout(opponentTurnTimer);
  match = createNewMatch();
  renderMatch();
}

function endTurn() {
  if (!match || match.turn !== PLAYER_SIDE) return;

  syncPlayerStateFromClient();
  match.turn = OPPONENT_SIDE;
  renderMatch();

  opponentTurnTimer = window.setTimeout(runOpponentTurn, 900);
}

function resetMatch() {
  window.clearTimeout(opponentTurnTimer);
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
