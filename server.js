import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import eventsHandler from './api/events.js';
import healthHandler from './api/health.js';
import patrolKilometersHandler from './api/patrol-kilometers.js';
import patrolsHandler from './api/patrols.js';
import patrolsUpdateHandler from './api/patrols-update.js';
import syncStatusHandler from './api/sync-status.js';
import { startPatrolSync } from './lib/patrol-sync.js';

const PORT = Number(process.env.PORT || 3000);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

const apiRoutes = [
  { pattern: /^\/api\/health\/?$/, handler: healthHandler },
  { pattern: /^\/api\/events\/?$/, handler: eventsHandler },
  { pattern: /^\/api\/patrol-kilometers\/?$/, handler: patrolKilometersHandler },
  { pattern: /^\/api\/patrols\/?$/, handler: patrolsHandler },
  { pattern: /^\/api\/patrols-update\/?$/, handler: patrolsUpdateHandler },
  { pattern: /^\/api\/sync-status\/?$/, handler: syncStatusHandler }
];

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const route = apiRoutes.find((candidate) => candidate.pattern.test(url.pathname));

    if (route) {
      const body = await readJsonBody(request);
      return route.handler(
        {
          body,
          headers: request.headers,
          method: request.method,
          query: Object.fromEntries(url.searchParams.entries()),
          url: request.url
        },
        createApiResponse(response)
      );
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`EarthRanger Reporting Tool running at http://localhost:${PORT}`);
  startPatrolSync();
});

async function readJsonBody(request) {
  if (!['POST', 'PATCH', 'PUT'].includes(request.method || '')) return undefined;

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;

  return JSON.parse(raw);
}

function createApiResponse(response) {
  return {
    headersSent: false,
    statusCode: 200,
    end(payload) {
      this.headersSent = true;
      response.end(payload);
      return this;
    },
    json(payload) {
      this.headersSent = true;
      if (!response.headersSent) {
        response.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      response.end(JSON.stringify(payload));
      return this;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    }
  };
}

async function serveStatic(pathname, response) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = safePath === '/' ? '/index.html' : safePath;
  const filePath = join(PUBLIC_DIR, requestedPath);

  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    const fallback = join(PUBLIC_DIR, 'index.html');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(fallback));
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}
