const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const DiceEngine = require('./shared/dieEngine');
const { DieRollerServer } = require('./shared/die-roller');
const { CardGameServer } = require('./shared/card-game');
const { PhaseManagerServer } = require('./shared/phase-manager');
const {
  CARD_TYPES,
  CARD_KINDS,
  CARD_STAT_DICE,
  listCards: listCatalogCards,
  createCard: createCatalogCard,
  updateCard: updateCatalogCard,
} = require('./shared/cards-catalog/mongoStore');
const {
  ABILITY_KINDS,
  listAbilities: listCatalogAbilities,
  createAbility: createCatalogAbility,
  updateAbility: updateCatalogAbility,
} = require('./shared/abilities-catalog/mongoStore');

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
const phaseManagerServer = new PhaseManagerServer({
  catalogProvider: async () => listCatalogCards(),
});
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

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/assets') {
    const assetsDir = path.join(PUBLIC_DIR, 'assets');
    fs.readdir(assetsDir, { withFileTypes: true }, (error, entries = []) => {
      if (error) {
        sendJson(res, 500, { error: 'Unable to list assets' });
        return;
      }

      const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
      const assets = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => imageExtensions.has(path.extname(name).toLowerCase()))
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({
          name,
          path: `/public/assets/${name}`,
        }));

      sendJson(res, 200, { assets });
    });
    return true;
  }

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


  if (req.method === 'GET' && pathname === '/api/projects/abilities') {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const abilityKind = requestUrl.searchParams.get('abilityKind');
      const abilities = await listCatalogAbilities({ abilityKind });
      sendJson(res, 200, { abilities, abilityKinds: ABILITY_KINDS });
    } catch (error) {
      sendJson(res, 500, { error: 'Unable to load abilities from database' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/projects/abilities') {
    try {
      const body = await readRequestJson(req);
      const ability = await createCatalogAbility(body);
      sendJson(res, 201, { ability });
    } catch (error) {
      const isValidationError =
        error.message.includes('required')
        || error.message.includes('abilityKind must be one of');
      sendJson(res, isValidationError ? 400 : 500, { error: error.message || 'Unable to create ability' });
    }
    return true;
  }

  const catalogAbilityMatch = pathname.match(/^\/api\/projects\/abilities\/([^/]+)$/);
  if (req.method === 'PUT' && catalogAbilityMatch) {
    try {
      const body = await readRequestJson(req);
      const ability = await updateCatalogAbility(catalogAbilityMatch[1], body);
      sendJson(res, 200, { ability });
    } catch (error) {
      const isValidationError =
        error.message.includes('required')
        || error.message.includes('abilityKind must be one of');
      const isNotFound = error.message === 'Ability not found';
      const statusCode = isNotFound ? 404 : isValidationError ? 400 : 500;
      sendJson(res, statusCode, { error: error.message || 'Unable to update ability' });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/projects/cards') {
    try {
      const cards = await listCatalogCards();
      sendJson(res, 200, {
        cards,
        cardTypes: CARD_TYPES,
        cardKinds: CARD_KINDS,
        cardStatDice: CARD_STAT_DICE,
      });
    } catch (error) {
      sendJson(res, 500, { error: 'Unable to load cards from database' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/projects/cards') {
    try {
      const body = await readRequestJson(req);
      const card = await createCatalogCard(body);
      sendJson(res, 201, { card });
    } catch (error) {
      const isValidationError =
        error.message.includes('required')
        || error.message.includes('must be an integer')
        || error.message.includes('must be one of')
        || error.message.includes('artworkImagePath must')
        || error.message.includes('ability1Id')
        || error.message.includes('ability2Id')
        || error.message.includes('Unknown abilities')
        || error.message.includes('but cardKind is');
      sendJson(res, isValidationError ? 400 : 500, { error: error.message || 'Unable to create card' });
    }
    return true;
  }

  const catalogCardMatch = pathname.match(/^\/api\/projects\/cards\/([^/]+)$/);
  if (req.method === 'PUT' && catalogCardMatch) {
    try {
      const body = await readRequestJson(req);
      const card = await updateCatalogCard(catalogCardMatch[1], body);
      sendJson(res, 200, { card });
    } catch (error) {
      const isValidationError =
        error.message.includes('required')
        || error.message.includes('must be an integer')
        || error.message.includes('must be one of')
        || error.message.includes('artworkImagePath must')
        || error.message.includes('ability1Id')
        || error.message.includes('ability2Id')
        || error.message.includes('Unknown abilities')
        || error.message.includes('but cardKind is');
      const isNotFound = error.message === 'Card not found';
      const statusCode = isNotFound ? 404 : isValidationError ? 400 : 500;
      sendJson(res, statusCode, { error: error.message || 'Unable to update card' });
    }
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

    sendJson(res, 200, phaseManagerServer.getPlayerPhaseStatus(playerId));
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

    sendJson(res, 200, await phaseManagerServer.findMatch(body.playerId));
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

    sendJson(res, 200, phaseManagerServer.reset(body.playerId));
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

    const result = phaseManagerServer.readyUp(body);
    if (result.error) {
      sendJson(res, result.statusCode || 400, { error: result.error });
      return true;
    }

    sendJson(res, result.statusCode || 200, result.payload);
    return true;
  }


  if (req.method === 'POST' && pathname === '/api/phase-manager/match/commit-complete') {
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

    const result = phaseManagerServer.completeCommitRolls(body);
    if (result.error) {
      sendJson(res, result.statusCode || 400, { error: result.error });
      return true;
    }

    sendJson(res, result.statusCode || 200, result.payload);
    return true;
  }



  if (req.method === 'POST' && pathname === '/api/phase-manager/match/commit-roll') {
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

    const result = phaseManagerServer.submitCommitRoll(body);
    if (result.error) {
      sendJson(res, result.statusCode || 400, { error: result.error });
      return true;
    }

    sendJson(res, result.statusCode || 200, result.payload);
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

    const result = phaseManagerServer.syncState(body);
    if (result.error) {
      sendJson(res, result.statusCode || 400, { error: result.error });
      return true;
    }

    sendJson(res, result.statusCode || 200, result.payload);
    return true;
  }


  return false;
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(filePath).replace(/^\.\.(\/|\\|$)/, '');

  const pathCandidates = [
    path.join(__dirname, safePath.startsWith('/') ? safePath.slice(1) : safePath),
    path.join(__dirname, safePath.startsWith('/') ? `${safePath.slice(1)}/index.html` : `${safePath}/index.html`),
    path.join(PUBLIC_DIR, safePath.startsWith('/') ? safePath.slice(1) : safePath),
    path.join(PUBLIC_DIR, safePath.startsWith('/') ? `${safePath.slice(1)}/index.html` : `${safePath}/index.html`),
  ];

  const tryReadCandidate = (index = 0) => {
    const candidatePath = pathCandidates[index];
    if (!candidatePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const isInsideRoot = candidatePath.startsWith(__dirname);
    if (!isInsideRoot) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(candidatePath, (error, content) => {
      if (error) {
        tryReadCandidate(index + 1);
        return;
      }

      const ext = path.extname(candidatePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain; charset=utf-8' });
      res.end(content);
    });
  };

  tryReadCandidate();
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
