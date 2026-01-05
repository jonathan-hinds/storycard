const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const instructionsPath = path.join(__dirname, 'instructions.txt');
const packPath = path.join(__dirname, 'pack.json');

let instructionsText = 'Instructions unavailable.';
let packData = null;
try {
  instructionsText = fs.readFileSync(instructionsPath, 'utf8');
} catch (error) {
  console.error('Failed to load instructions:', error);
}

try {
  const rawPack = fs.readFileSync(packPath, 'utf8');
  packData = JSON.parse(rawPack);
} catch (error) {
  console.error('Failed to load pack data:', error);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function serveInstructions(res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ instructions: instructionsText }));
}

function servePack(res) {
  if (!packData) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Pack data unavailable.' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(packData));
}

function serveStatic(pathname, res) {
  const safeSuffix = pathname.replace(/^\/+/, '');
  const requestPath = safeSuffix === '' ? 'index.html' : safeSuffix;
  const resolvedPath = path.join(publicDir, requestPath);

  if (!resolvedPath.startsWith(publicDir)) {
    sendNotFound(res);
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err) {
      sendNotFound(res);
      return;
    }

    const filePath = stats.isDirectory()
      ? path.join(resolvedPath, 'index.html')
      : resolvedPath;

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        sendNotFound(res);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && pathname === '/api/instructions') {
    serveInstructions(res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/pack') {
    servePack(res);
    return;
  }

  serveStatic(pathname, res);
});

server.listen(PORT, () => {
  console.log(`Storycard server running at http://localhost:${PORT}`);
});
