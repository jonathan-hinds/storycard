const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const DiceEngine = require('./shared/dieEngine');
const { DieRollerServer } = require('./shared/die-roller');

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

const cardStore = new Map([
  ['card-alpha', { id: 'card-alpha', held: false, updatedAt: null }],
  ['card-beta', { id: 'card-beta', held: false, updatedAt: null }],
  ['card-gamma', { id: 'card-gamma', held: false, updatedAt: null }],
  ['card-delta', { id: 'card-delta', held: false, updatedAt: null }],
]);

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
    sendJson(res, 200, { cards: Array.from(cardStore.values()) });
    return true;
  }

  const cardActionMatch = pathname.match(/^\/api\/cards\/([^/]+)\/(pickup|putdown)$/);
  if (req.method === 'POST' && cardActionMatch) {
    const [, cardId, action] = cardActionMatch;
    const card = cardStore.get(cardId);

    if (!card) {
      sendJson(res, 404, { error: 'Card not found' });
      return true;
    }

    card.held = action === 'pickup';
    card.updatedAt = Date.now();

    sendJson(res, 200, { card });
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
