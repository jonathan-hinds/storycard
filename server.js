const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const DiceEngine = require('./shared/dieEngine');
const { DieRollerServer } = require('./shared/die-roller');
const { CardGameServer } = require('./shared/card-game');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const diceStore = new Map();
const dieRollerServer = new DieRollerServer();
const phaseQueue = [];
const phaseMatchmakingState = new Map();
const phaseMatches = new Map();
const PHASE_DECK_SIZE_PER_PLAYER = 10;
const PHASE_STARTING_HAND_SIZE = 3;
const PHASE_MAX_HAND_SIZE = 7;
const PHASE_BOARD_SLOTS_PER_SIDE = 3;

const cardGameServer = new CardGameServer({
  cards: [
    { id: 'card-alpha', held: false, updatedAt: null, zone: 'board', slotIndex: 0 },
    { id: 'card-beta', held: false, updatedAt: null, zone: 'board', slotIndex: 1 },
    { id: 'card-gamma', held: false, updatedAt: null, zone: 'board', slotIndex: 3 },
    { id: 'card-delta', held: false, updatedAt: null, zone: 'board', slotIndex: 4 },
  ],
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(payload));
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function createDie(body) {
  const sides = DiceEngine.normalizeSides(body.sides);
  const areaSize = Number.isFinite(body.areaSize) ? Math.max(4, Number(body.areaSize)) : 8;
  const die = {
    id: randomUUID(),
    sides,
    areaSize,
    history: [],
  };
  diceStore.set(die.id, die);
  return die;
}

function rollDie(die, options = {}) {
  const roll = dieRollerServer.roll({
    dieId: die.id,
    sides: die.sides,
    areaSize: die.areaSize,
    debug: options.debug,
    tuning: options.tuning,
  });

  die.history.push(roll);
  if (die.history.length > 50) {
    die.history.shift();
  }

  return roll;
}

function getQueuePosition(playerId) {
  const index = phaseQueue.indexOf(playerId);
  return index === -1 ? null : index + 1;
}

function removeFromQueue(playerId) {
  const index = phaseQueue.indexOf(playerId);
  if (index !== -1) {
    phaseQueue.splice(index, 1);
  }
}

function clearPlayerMatchmakingState(playerId) {
  removeFromQueue(playerId);
  const current = phaseMatchmakingState.get(playerId);
  if (!current) {
    return;
  }

  if (current.status === 'matched' && current.matchId) {
    const match = phaseMatches.get(current.matchId);
    if (match) {
      phaseMatches.delete(current.matchId);
      const otherPlayerId = match.players.find((id) => id !== playerId);
      if (otherPlayerId) {
        phaseMatchmakingState.set(otherPlayerId, { status: 'idle' });
      }
    }
  }

  phaseMatchmakingState.set(playerId, { status: 'idle' });
}

function randomCardColor() {
  const colorPool = [0x5f8dff, 0x8f6cff, 0x2dc6ad, 0xf28a65, 0xf1c965, 0xe76fb9, 0x4ecdc4, 0xff6b6b, 0xc7f464, 0xffa94d];
  return colorPool[Math.floor(Math.random() * colorPool.length)];
}

function serializeMatchForPlayer(match, playerId) {
  const opponentId = match.players.find((id) => id !== playerId) || null;
  const playerState = match.cardsByPlayer.get(playerId);
  const opponentState = opponentId ? match.cardsByPlayer.get(opponentId) : null;

  if (!playerState || !opponentState || !opponentId) {
    return null;
  }

  return {
    id: match.id,
    turnNumber: match.turnNumber,
    phase: match.phase,
    youAreReady: match.readyPlayers.has(playerId),
    opponentIsReady: opponentId ? match.readyPlayers.has(opponentId) : false,
    players: {
      player: {
        hand: [...playerState.hand],
        board: [...playerState.board],
        deckCount: playerState.deck.length,
      },
      opponent: {
        hand: [...opponentState.hand],
        board: [...opponentState.board],
        deckCount: opponentState.deck.length,
      },
    },
    meta: {
      drawnCardIds: [...(match.lastDrawnCardsByPlayer.get(playerId) || [])],
    },
  };
}

function drawCardAtStartOfDecisionPhase(playerState) {
  if (!playerState || !playerState.deck.length || playerState.hand.length >= PHASE_MAX_HAND_SIZE) {
    return [];
  }

  const drawnCard = playerState.deck.shift();
  playerState.hand.push(drawnCard);
  return [drawnCard.id];
}

function applyDecisionPhaseStartDraw(match) {
  const drawnCardsByPlayer = new Map();

  match.players.forEach((playerId) => {
    const playerState = match.cardsByPlayer.get(playerId);
    const drawnCardIds = drawCardAtStartOfDecisionPhase(playerState);
    drawnCardsByPlayer.set(playerId, drawnCardIds);
  });

  match.lastDrawnCardsByPlayer = drawnCardsByPlayer;
}

function advanceMatchToDecisionPhase(match) {
  match.turnNumber += 1;
  match.phase = 1;
  match.readyPlayers.clear();
  applyDecisionPhaseStartDraw(match);
}

function resolveCommitPhase(match) {
  match.phase = 2;
  // Placeholder for future action resolution logic.
  // For now the commit phase resolves immediately and starts the next turn.
  advanceMatchToDecisionPhase(match);
}

function readyPlayerInMatch(match, playerId) {
  match.readyPlayers.add(playerId);

  const allPlayersReady = match.players.every((id) => match.readyPlayers.has(id));
  if (!allPlayersReady) return;

  resolveCommitPhase(match);
}

function validatePhaseTurnPayload(payload, playerState) {
  const hand = Array.isArray(payload.hand) ? payload.hand : [];
  const board = Array.isArray(payload.board) ? payload.board : [];

  if (board.length > PHASE_BOARD_SLOTS_PER_SIDE) {
    return { error: `board is limited to ${PHASE_BOARD_SLOTS_PER_SIDE} cards` };
  }

  if (hand.length > PHASE_MAX_HAND_SIZE) {
    return { error: `hand is limited to ${PHASE_MAX_HAND_SIZE} cards` };
  }

  const visibleCards = [...playerState.hand, ...playerState.board];
  const knownCards = new Map(visibleCards.map((card) => [card.id, card]));
  const merged = [...hand, ...board];
  const uniqueIds = new Set(merged.map((card) => card.id));
  if (merged.length !== uniqueIds.size) {
    return { error: 'hand and board must not contain duplicate cards' };
  }


  if (uniqueIds.size !== knownCards.size) {
    return { error: `expected exactly ${knownCards.size} cards between hand and board` };
  }
  for (const cardId of uniqueIds) {
    if (!knownCards.has(cardId)) {
      return { error: `unknown card submitted: ${cardId}` };
    }
  }

  const usedBoardSlots = new Set();
  const normalizedBoard = [];
  for (const boardCard of board) {
    if (!Number.isInteger(boardCard.slotIndex)) {
      return { error: 'board card entries must include an integer slotIndex' };
    }
    if (boardCard.slotIndex < 0 || boardCard.slotIndex >= PHASE_BOARD_SLOTS_PER_SIDE) {
      return { error: `board slotIndex must be between 0 and ${PHASE_BOARD_SLOTS_PER_SIDE - 1}` };
    }
    if (usedBoardSlots.has(boardCard.slotIndex)) {
      return { error: 'board card slotIndex values must be unique' };
    }
    usedBoardSlots.add(boardCard.slotIndex);
    normalizedBoard.push({
      ...knownCards.get(boardCard.id),
      slotIndex: boardCard.slotIndex,
    });
  }

  return {
    hand: hand.map((card) => knownCards.get(card.id)),
    board: normalizedBoard,
  };
}

function getPlayerPhaseStatus(playerId) {
  const status = phaseMatchmakingState.get(playerId) || { status: 'idle' };
  if (status.status === 'searching') {
    return {
      status: 'searching',
      queueCount: phaseQueue.length,
      queuePosition: getQueuePosition(playerId),
    };
  }

  if (status.status === 'matched' && status.matchId) {
    const match = phaseMatches.get(status.matchId);
    if (!match) {
      phaseMatchmakingState.set(playerId, { status: 'idle' });
      return { status: 'idle', queueCount: phaseQueue.length };
    }
    const opponentId = match.players.find((id) => id !== playerId) || null;
    return {
      status: 'matched',
      matchId: match.id,
      opponentId,
      queueCount: phaseQueue.length,
      matchState: serializeMatchForPlayer(match, playerId),
    };
  }

  return { status: 'idle', queueCount: phaseQueue.length };
}

function findPhaseMatch(playerId) {
  const existing = getPlayerPhaseStatus(playerId);
  if (existing.status === 'matched' || existing.status === 'searching') {
    return existing;
  }

  const opponentId = phaseQueue.shift();
  if (opponentId && opponentId !== playerId) {
    const matchId = `match-${randomUUID().slice(0, 8)}`;
    const players = [opponentId, playerId];
    const cardsByPlayer = new Map();

    players.forEach((id) => {
      const cards = Array.from({ length: PHASE_DECK_SIZE_PER_PLAYER }, (_, index) => ({
        id: `${id}-card-${index + 1}`,
        color: randomCardColor(),
      }));
      cardsByPlayer.set(id, {
        allCards: cards,
        hand: cards.slice(0, PHASE_STARTING_HAND_SIZE),
        board: [],
        deck: cards.slice(PHASE_STARTING_HAND_SIZE),
      });
    });

    const match = {
      id: matchId,
      players,
      cardsByPlayer,
      turnNumber: 1,
      phase: 1,
      readyPlayers: new Set(),
      lastDrawnCardsByPlayer: new Map(),
      createdAt: Date.now(),
    };
    phaseMatches.set(matchId, match);
    phaseMatchmakingState.set(opponentId, { status: 'matched', matchId });
    phaseMatchmakingState.set(playerId, { status: 'matched', matchId });
    return getPlayerPhaseStatus(playerId);
  }

  phaseQueue.push(playerId);
  phaseMatchmakingState.set(playerId, { status: 'searching' });
  return getPlayerPhaseStatus(playerId);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/dice') {
    const list = Array.from(diceStore.values()).map((die) => ({
      id: die.id,
      sides: die.sides,
      areaSize: die.areaSize,
      rolls: die.history.length,
      lastOutcome: die.history[die.history.length - 1]?.outcome ?? null,
    }));
    sendJson(res, 200, { dice: list });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/dice') {
    try {
      const body = await readRequestJson(req);
      const die = createDie(body);
      sendJson(res, 201, {
        die: {
          id: die.id,
          sides: die.sides,
          areaSize: die.areaSize,
        },
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const rollMatch = pathname.match(/^\/api\/dice\/([^/]+)\/roll$/);
  if (req.method === 'POST' && rollMatch) {
    const dieId = rollMatch[1];
    const die = diceStore.get(dieId);
    if (!die) {
      sendJson(res, 404, { error: 'Die not found' });
      return true;
    }
    let body = {};
    try {
      body = await readRequestJson(req);
    } catch (error) {
      body = {};
    }

    const roll = rollDie(die, { debug: body.debugPhysics, tuning: body.tuning });
    if (body.debugPhysics && roll.metadata?.diagnostics) {
      console.log(`[physics-debug] die=${dieId} sides=${die.sides} dotUp=${roll.metadata.diagnostics.topDotUp.toFixed(4)} contacts=${roll.metadata.diagnostics.contactPoints}`);
      for (const line of roll.metadata.diagnostics.logs || []) {
        console.log(`[physics-debug] ${line}`);
      }
    }
    sendJson(res, 200, { dieId, roll });
    return true;
  }


  if (req.method === 'GET' && pathname === '/api/cards') {
    sendJson(res, 200, { cards: cardGameServer.listCards() });
    return true;
  }

  const cardActionMatch = pathname.match(/^\/api\/cards\/([^/]+)\/(pickup|putdown)$/);
  if (req.method === 'POST' && cardActionMatch) {
    const [, cardId, action] = cardActionMatch;
    const card = cardGameServer.getCard(cardId);

    if (!card) {
      sendJson(res, 404, { error: 'Card not found' });
      return true;
    }

    let payload = {};
    try {
      payload = await readRequestJson(req);
    } catch (error) {
      payload = {};
    }

    const updatedCard = cardGameServer.applyCardAction(cardId, action, payload);
    sendJson(res, 200, { card: updatedCard });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/dice\/([^/]+)\/history$/);
  if (req.method === 'GET' && historyMatch) {
    const dieId = historyMatch[1];
    const die = diceStore.get(dieId);
    if (!die) {
      sendJson(res, 404, { error: 'Die not found' });
      return true;
    }

    sendJson(res, 200, {
      dieId,
      sides: die.sides,
      areaSize: die.areaSize,
      history: die.history,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/phase-manager/matchmaking/status') {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const playerId = requestUrl.searchParams.get('playerId');
    if (!playerId) {
      sendJson(res, 400, { error: 'playerId is required' });
      return true;
    }

    sendJson(res, 200, getPlayerPhaseStatus(playerId));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/phase-manager/matchmaking/find') {
    let body = {};
    try {
      body = await readRequestJson(req);
    } catch (error) {
      body = {};
    }

    if (!body.playerId || typeof body.playerId !== 'string') {
      sendJson(res, 400, { error: 'playerId is required' });
      return true;
    }

    sendJson(res, 200, findPhaseMatch(body.playerId));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/phase-manager/matchmaking/reset') {
    let body = {};
    try {
      body = await readRequestJson(req);
    } catch (error) {
      body = {};
    }

    if (!body.playerId || typeof body.playerId !== 'string') {
      sendJson(res, 400, { error: 'playerId is required' });
      return true;
    }

    clearPlayerMatchmakingState(body.playerId);
    sendJson(res, 200, { status: 'idle', queueCount: phaseQueue.length });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/phase-manager/match/ready') {
    let body = {};
    try {
      body = await readRequestJson(req);
    } catch (error) {
      body = {};
    }

    if (!body.playerId || typeof body.playerId !== 'string') {
      sendJson(res, 400, { error: 'playerId is required' });
      return true;
    }

    const status = phaseMatchmakingState.get(body.playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      sendJson(res, 409, { error: 'player is not in an active match' });
      return true;
    }

    const match = phaseMatches.get(status.matchId);
    if (!match) {
      sendJson(res, 409, { error: 'active match not found' });
      return true;
    }

    if (match.phase !== 1) {
      sendJson(res, 409, { error: 'cannot ready up outside decision phase' });
      return true;
    }

    if (match.readyPlayers.has(body.playerId)) {
      sendJson(res, 409, { error: 'player is already readied up for this phase' });
      return true;
    }

    const playerState = match.cardsByPlayer.get(body.playerId);
    if (!playerState) {
      sendJson(res, 409, { error: 'player state not found in active match' });
      return true;
    }

    const validated = validatePhaseTurnPayload(body, playerState);
    if (validated.error) {
      sendJson(res, 400, { error: validated.error });
      return true;
    }

    playerState.hand = validated.hand;
    playerState.board = validated.board;
    readyPlayerInMatch(match, body.playerId);

    sendJson(res, 200, getPlayerPhaseStatus(body.playerId));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/phase-manager/match/sync-state') {
    let body = {};
    try {
      body = await readRequestJson(req);
    } catch (error) {
      body = {};
    }

    if (!body.playerId || typeof body.playerId !== 'string') {
      sendJson(res, 400, { error: 'playerId is required' });
      return true;
    }

    const status = phaseMatchmakingState.get(body.playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      sendJson(res, 409, { error: 'player is not in an active match' });
      return true;
    }

    const match = phaseMatches.get(status.matchId);
    if (!match) {
      sendJson(res, 409, { error: 'active match not found' });
      return true;
    }

    if (match.phase !== 1) {
      sendJson(res, 409, { error: 'cannot sync state outside decision phase' });
      return true;
    }

    if (match.readyPlayers.has(body.playerId)) {
      sendJson(res, 409, { error: 'cannot sync state after you are readied up' });
      return true;
    }

    const playerState = match.cardsByPlayer.get(body.playerId);
    if (!playerState) {
      sendJson(res, 409, { error: 'player state not found in active match' });
      return true;
    }

    const validated = validatePhaseTurnPayload(body, playerState);
    if (validated.error) {
      sendJson(res, 400, { error: validated.error });
      return true;
    }

    playerState.hand = validated.hand;
    playerState.board = validated.board;

    sendJson(res, 200, getPlayerPhaseStatus(body.playerId));
    return true;
  }


  return false;
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(filePath).replace(/^\.\.(\/|\\|$)/, '');

  const fullPath = path.join(__dirname, safePath.startsWith('/') ? safePath.slice(1) : safePath);
  const isInsideRoot = fullPath.startsWith(__dirname);
  if (!isInsideRoot) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const mimeType = MIME_TYPES[ext] || 'text/plain; charset=utf-8';

  fs.readFile(fullPath, (error, content) => {
    if (!error) {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content);
      return;
    }

    const fallbackPath = path.join(PUBLIC_DIR, filePath === '/' ? 'index.html' : filePath);
    fs.readFile(fallbackPath, (fallbackError, fallbackContent) => {
      if (fallbackError) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const fallbackExt = path.extname(fallbackPath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[fallbackExt] || 'text/plain; charset=utf-8' });
      res.end(fallbackContent);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, pathname);
    if (!handled) {
      sendJson(res, 404, { error: 'Endpoint not found' });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Storycard dice server running at http://localhost:${PORT}`);
});
