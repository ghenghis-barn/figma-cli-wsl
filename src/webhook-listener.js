#!/usr/bin/env node

import { createServer } from 'http';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { summarizeWebhookEvent } from './figma-rest.js';

function parseArgs(argv) {
  const out = {
    host: '127.0.0.1',
    port: 8787,
    path: '/figma-webhook',
    verify: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host') out.host = argv[++i];
    else if (arg === '--port') out.port = parseInt(argv[++i], 10);
    else if (arg === '--path') out.path = argv[++i];
    else if (arg === '--passcode') out.passcode = argv[++i];
    else if (arg === '--events-file') out.eventsFile = argv[++i];
    else if (arg === '--no-verify') out.verify = false;
    else if (arg === '--json') out.json = true;
  }
  return out;
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Webhook payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(message) {
  if (process.send) {
    process.send(message);
    return;
  }
  if (message.type === 'event') {
    console.log(message.summary);
  } else if (message.type === 'ready') {
    console.log(`Listening on ${message.url}`);
  } else if (message.type === 'error') {
    console.error(message.error);
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.verify && !options.passcode) {
  send({
    type: 'error',
    error: 'Webhook passcode is required unless --no-verify is passed.',
  });
  process.exit(1);
}

if (options.eventsFile) {
  mkdirSync(dirname(resolve(options.eventsFile)), { recursive: true });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${options.host}:${options.port}`}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method !== 'POST' || url.pathname !== options.path) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  try {
    const body = await readBody(req);
    const payload = body ? JSON.parse(body) : {};

    if (options.verify && payload.passcode !== options.passcode) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid passcode' }));
      send({
        type: 'rejected',
        reason: 'invalid passcode',
        event_type: payload.event_type || null,
      });
      return;
    }

    const receivedAt = new Date().toISOString();
    const event = { received_at: receivedAt, payload };
    if (options.eventsFile) {
      appendFileSync(options.eventsFile, `${JSON.stringify(event)}\n`);
    }

    const summary = summarizeWebhookEvent(payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    send({
      type: 'event',
      received_at: receivedAt,
      summary,
      payload,
    });
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
    send({
      type: 'rejected',
      reason: error.message,
    });
  }
});

server.on('error', (error) => {
  send({
    type: 'error',
    error: `Could not start webhook listener on ${options.host}:${options.port}: ${error.message}`,
  });
  process.exit(1);
});

server.listen(options.port, options.host, () => {
  send({
    type: 'ready',
    url: `http://${options.host}:${options.port}${options.path}`,
    host: options.host,
    port: options.port,
    path: options.path,
    eventsFile: options.eventsFile || null,
  });
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
