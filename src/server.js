import http from 'node:http';
import { URL } from 'node:url';
import { loadConfig } from './config.js';
import { closeDatabase, createDatabase, migrate } from './db.js';
import { verifyLineSignature } from './line/signature.js';
import { processWebhook } from './webhook/handler.js';

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
await migrate();

function sendJson(response, statusCode, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length
  });
  response.end(data);
}

function readRawBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      await database.query('SELECT 1 AS ok');
      sendJson(response, 200, { ok: true, service: 'line-predict-bot' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const rawBody = await readRawBody(request, config.maxBodyBytes);
      const signature = request.headers['x-line-signature'];
      if (!verifyLineSignature(rawBody, signature, config.lineChannelSecret)) {
        sendJson(response, 401, { ok: false, error: 'invalid_signature' });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        sendJson(response, 400, { ok: false, error: 'invalid_json' });
        return;
      }

      await processWebhook(payload, config);
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error('HTTP request failed', error);
    if (!response.headersSent) {
      sendJson(response, error.statusCode ?? 500, { ok: false, error: 'internal_error' });
    } else {
      response.end();
    }
  }
});

server.listen(config.port, () => {
  console.log(`LINE prediction game listening on port ${config.port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
