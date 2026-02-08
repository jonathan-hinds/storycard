const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const DiceService = require('./shared/diceService');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const diceService = new DiceService();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(payload));
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/dice') {
    sendJson(res, 200, { dice: diceService.listDice() });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/dice') {
    try {
      const body = await readRequestJson(req);
      const die = diceService.createDie(body);
      sendJson(res, 201, { die: { id: die.id, sides: die.sides, areaSize: die.areaSize } });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const rollMatch = pathname.match(/^\/api\/dice\/([^/]+)\/roll$/);
  if (req.method === 'POST' && rollMatch) {
    const dieId = rollMatch[1];
    const die = diceService.getDie(dieId);
    if (!die) {
      sendJson(res, 404, { error: 'Die not found' });
      return true;
    }

    let body = {};
    try {
      body = await readRequestJson(req);
    } catch {
      body = {};
    }

    const rollResult = diceService.rollDie(dieId, { debug: body.debugPhysics, tuning: body.tuning });
    const roll = rollResult?.roll;

    if (body.debugPhysics && roll?.metadata?.diagnostics) {
      console.log(`[physics-debug] die=${dieId} sides=${die.sides} dotUp=${roll.metadata.diagnostics.topDotUp.toFixed(4)} contacts=${roll.metadata.diagnostics.contactPoints}`);
      for (const line of roll.metadata.diagnostics.logs || []) {
        console.log(`[physics-debug] ${line}`);
      }
    }

    sendJson(res, 200, { dieId, roll });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/dice\/([^/]+)\/history$/);
  if (req.method === 'GET' && historyMatch) {
    const history = diceService.getHistory(historyMatch[1]);
    if (!history) {
      sendJson(res, 404, { error: 'Die not found' });
      return true;
    }

    sendJson(res, 200, history);
    return true;
  }

  return false;
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(filePath).replace(/^\.\.(\/|\\|$)/, '');

  const fullPath = path.join(__dirname, safePath.startsWith('/') ? safePath.slice(1) : safePath);
  if (!fullPath.startsWith(__dirname)) {
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
    if (!handled) sendJson(res, 404, { error: 'Endpoint not found' });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Storycard dice server running at http://localhost:${PORT}`);
});
