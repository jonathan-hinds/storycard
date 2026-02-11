import { CardGameClient, CARD_ZONE_TYPES, DEFAULT_ZONE_FRAMEWORK, createDeckToHandDealHook } from '/public/card-game/index.js';

const canvas = document.getElementById('phase-manager-canvas');
const statusEl = document.getElementById('phase-manager-status');
const matchmakingBtn = document.getElementById('phase-manager-matchmaking');
const readyBtn = document.getElementById('phase-manager-ready');
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
let lastAnimatedMatchId = null;
let lastAnimatedTurnKey = null;
let lastAnimatedCommitKey = null;

function createTabPlayerId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `player-${window.crypto.randomUUID().slice(0, 8)}`;
  }
  return `player-${Math.random().toString(36).slice(2, 10)}`;
}

const playerId = createTabPlayerId();

function getPhaseLabel(phase) {
  return phase === 1 ? 'Decision' : 'Commit';
}

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
  const animatedDrawCardIds = new Set(currentMatch.meta?.animatedDrawCardIds || []);
  const initialCards = [];

  currentMatch.players[OPPONENT_SIDE].board.forEach((card, index) => {
    const slotIndex = Number.isInteger(card.slotIndex) ? card.slotIndex : index;
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: OPPONENT_SIDE,
      zone: CARD_ZONE_TYPES.BOARD,
      slotIndex,
      canAttack: false,
      attackCommitted: false,
      targetSlotIndex: null,
    });
  });

  currentMatch.players[PLAYER_SIDE].board.forEach((card, index) => {
    const relativeSlotIndex = Number.isInteger(card.slotIndex) ? card.slotIndex : index;
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: PLAYER_SIDE,
      zone: CARD_ZONE_TYPES.BOARD,
      slotIndex: BOARD_SLOTS_PER_SIDE + relativeSlotIndex,
      canAttack: card.canAttack === true,
      attackCommitted: card.attackCommitted === true,
      targetSlotIndex: Number.isInteger(card.targetSlotIndex) ? card.targetSlotIndex : null,
    });
  });

  currentMatch.players[PLAYER_SIDE].hand.forEach((card, handIndex) => {
    initialCards.push({
      id: card.id,
      color: card.color,
      owner: PLAYER_SIDE,
      zone: CARD_ZONE_TYPES.HAND,
      dealOrder: animatedDrawCardIds.has(card.id) ? handIndex : null,
      shouldDealAnimate: animatedDrawCardIds.has(card.id),
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
  if (!client || !match) return { hand: [], board: [], attacks: [] };

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
    .map(({ id, color, slotIndex }) => ({ id, color, slotIndex: slotIndex - BOARD_SLOTS_PER_SIDE }));

  const attacks = typeof client.getCombatDecisions === 'function' ? client.getCombatDecisions() : [];

  return { hand, board, attacks };
}

function setReadyLockState() {
  const isDecisionPhase = Boolean(match) && match.phase === 1;
  const playerIsReady = Boolean(match) && match.youAreReady;
  const canInteract = isDecisionPhase && !playerIsReady;

  readyBtn.disabled = !match || !canInteract;
  canvas.style.pointerEvents = canInteract ? 'auto' : 'none';

  if (!match) {
    overlayEl.hidden = false;
    overlayEl.textContent = 'Start matchmaking to begin a match.';
    return;
  }

  if (match.phase === 2) {
    overlayEl.hidden = false;
    overlayEl.textContent = 'Commit phase resolving…';
    return;
  }

  overlayEl.hidden = !playerIsReady;
  overlayEl.textContent = playerIsReady ? 'Locked in. Waiting for opponent to ready up…' : '';
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
  matchLabelEl.textContent = `${match.id} • Turn ${match.turnNumber} • Phase ${match.phase} (${getPhaseLabel(match.phase)})`;
  playerSummaryEl.textContent = `Player — hand: ${player.hand.length}, board: ${player.board.length}, deck: ${player.deckCount}`;
  opponentSummaryEl.textContent = `Opponent — hand: ${opponent.hand.length}, board: ${opponent.board.length}, deck: ${opponent.deckCount}${match.phase === 1 ? `, ready: ${match.opponentIsReady ? 'yes' : 'no'}` : ''}`;
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
    statusEl.textContent = 'Click matchmaking to create a 1v1 phase test.';
    setReadyLockState();
    updateSummaryPanels();
    return;
  }

  const template = buildTemplateFromMatch(match);
  const shouldAnimateInitialDeal = match.id !== lastAnimatedMatchId;
  const turnAnimationKey = `${match.id}:${match.turnNumber}`;
  const shouldAnimateTurnDraw = Boolean(match.meta?.animatedDrawCardIds?.length) && turnAnimationKey !== lastAnimatedTurnKey;
  template.meta = {
    animateInitialDeal: shouldAnimateInitialDeal,
    animateTurnDraw: shouldAnimateTurnDraw,
  };
  if (!client) {
    client = new CardGameClient({
      canvas,
      statusElement: statusEl,
      template,
      options: {
        onCardStateCommitted: syncMatchStateAfterCardCommit,
        cardAnimationHooks: [
          createDeckToHandDealHook({
            owner: PLAYER_SIDE,
            shouldAnimate: (card, context) => {
              if (context.template?.meta?.animateInitialDeal === true) return true;
              if (context.template?.meta?.animateTurnDraw === true) return card.userData.shouldDealAnimate === true;
              return false;
            },
            durationMs: 980,
            staggerMs: 105,
            arcHeight: 0.95,
            swirlAmplitude: 0.14,
          }),
        ],
      },
    });
  } else {
    client.template = template;
    client.resetDemo();
  }

  if (shouldAnimateInitialDeal) lastAnimatedMatchId = match.id;
  if (shouldAnimateTurnDraw) lastAnimatedTurnKey = turnAnimationKey;

  const commitAnimationKey = `${match.id}:${match.turnNumber}:${match.phase}`;
  const commitAttacks = Array.isArray(match.meta?.commitAttacks) ? match.meta.commitAttacks : [];
  if (match.phase === 2 && client && typeof client.playCommitPhaseAnimations === 'function' && commitAnimationKey !== lastAnimatedCommitKey) {
    client.playCommitPhaseAnimations(commitAttacks, { syncStartAtMs: match.meta?.commitAnimationsStartAt || ((match.meta?.phaseStartedAt || Date.now()) + 250) });
    lastAnimatedCommitKey = commitAnimationKey;
  }

  statusEl.textContent = match.phase === 1
    ? (match.youAreReady
      ? 'You are readied up. Waiting for opponent to ready…'
      : 'Decision phase: play cards, then drag ready board cards onto enemy cards to queue attacks, then click Ready Up.')
    : 'Commit phase resolving automatically…';

  setReadyLockState();
  updateSummaryPanels();
}

async function syncMatchStateAfterCardCommit() {
  if (!match || match.phase !== 1 || match.youAreReady || stateSyncInFlight) return;

  const nextState = syncPlayerStateFromClient();
  stateSyncInFlight = true;
  try {
    const status = await postJson('/api/phase-manager/match/sync-state', {
      playerId,
      hand: nextState.hand,
      board: nextState.board,
      attacks: nextState.attacks,
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
    if (nextMatch && match) {
      const isNewTurn = nextMatch.turnNumber > match.turnNumber && nextMatch.phase === 1;
      const drawnCardIds = Array.isArray(nextMatch.meta?.drawnCardIds) ? nextMatch.meta.drawnCardIds : [];
      const previousAnimatedDrawCardIds = Array.isArray(match.meta?.animatedDrawCardIds)
        ? match.meta.animatedDrawCardIds
        : [];
      nextMatch.meta = {
        ...nextMatch.meta,
        animatedDrawCardIds: isNewTurn ? drawnCardIds : previousAnimatedDrawCardIds,
      };
    }

    if (nextMatch && !match) {
      nextMatch.meta = {
        ...nextMatch.meta,
        animatedDrawCardIds: [],
      };
    }

    const nextSerialized = JSON.stringify(nextMatch);
    const currentSerialized = JSON.stringify(match);
    if (nextSerialized !== currentSerialized) {
      match = nextMatch;
      renderMatch();
    } else {
      setReadyLockState();
      updateSummaryPanels();
    }
    return;
  }

  match = null;
  lastAnimatedMatchId = null;
  lastAnimatedTurnKey = null;
  lastAnimatedCommitKey = null;
  if (client) {
    client.destroy();
    client = null;
  }

  if (status.status === 'searching') {
    statusEl.textContent = 'Looking for match... Waiting for another player to queue.';
    matchmakingBtn.disabled = true;
    matchmakingBtn.textContent = 'Searching...';
    setReadyLockState();
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

function readyUp() {
  if (!match || match.phase !== 1 || match.youAreReady) return;

  const nextState = syncPlayerStateFromClient();
  readyBtn.disabled = true;

  postJson('/api/phase-manager/match/ready', {
    playerId,
    hand: nextState.hand,
    board: nextState.board,
    attacks: nextState.attacks,
  })
    .then((status) => {
      applyMatchmakingStatus(status);
    })
    .catch((error) => {
      statusEl.textContent = `Ready up error: ${error.message}`;
      setReadyLockState();
    });
}

function resetMatch() {
  stopMatchmakingPolling();

  match = null;
  lastAnimatedMatchId = null;
  lastAnimatedTurnKey = null;
  lastAnimatedCommitKey = null;
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
readyBtn.addEventListener('click', readyUp);
resetBtn.addEventListener('click', resetMatch);

renderMatch();
matchmakingPollTimer = window.setInterval(pollMatchmakingStatus, 1200);
pollMatchmakingStatus();
