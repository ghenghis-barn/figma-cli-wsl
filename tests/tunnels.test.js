import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTunnelPath,
  buildNgrokArgs,
  extractNgrokUrl,
  healthUrlForTunnel,
  localHostForTunnel,
  normalizeApiBase,
  normalizeTunnelProvider,
  selectNgrokPublicUrl,
} from '../src/tunnels.js';

test('normalizes tunnel provider aliases', () => {
  assert.equal(normalizeTunnelProvider(), 'localtunnel');
  assert.equal(normalizeTunnelProvider('lt'), 'localtunnel');
  assert.equal(normalizeTunnelProvider('ngrok'), 'ngrok');
  assert.throws(() => normalizeTunnelProvider('cloudflare'), /Unsupported tunnel provider/);
});

test('builds tunnel paths and health URLs without duplicate slashes', () => {
  assert.equal(appendTunnelPath('https://abc.ngrok.app/', '/figma-webhook'), 'https://abc.ngrok.app/figma-webhook');
  assert.equal(appendTunnelPath('https://abc.ngrok.app', 'figma-webhook'), 'https://abc.ngrok.app/figma-webhook');
  assert.equal(healthUrlForTunnel('https://abc.ngrok.app/figma-webhook'), 'https://abc.ngrok.app/health');
});

test('maps wildcard local hosts to loopback for tunnel upstreams', () => {
  assert.equal(localHostForTunnel('0.0.0.0'), '127.0.0.1');
  assert.equal(localHostForTunnel('::'), '127.0.0.1');
  assert.equal(localHostForTunnel('localhost'), 'localhost');
});

test('normalizes ngrok Agent API bases', () => {
  assert.equal(normalizeApiBase('4041'), 'http://127.0.0.1:4041/api');
  assert.equal(normalizeApiBase('http://127.0.0.1:4040'), 'http://127.0.0.1:4040/api');
  assert.equal(normalizeApiBase('http://127.0.0.1:4040/api/'), 'http://127.0.0.1:4040/api');
});

test('selects the matching HTTPS ngrok URL from endpoint or tunnel payloads', () => {
  const target = 'http://127.0.0.1:8787';
  assert.equal(selectNgrokPublicUrl({
    endpoints: [
      { url: 'https://wrong.ngrok.app', upstream: { url: 'http://127.0.0.1:3000' } },
      { url: 'https://right.ngrok.app', upstream: { url: target } },
    ],
  }, target), 'https://right.ngrok.app');

  assert.equal(selectNgrokPublicUrl({
    tunnels: [
      { public_url: 'http://plain.ngrok.app', config: { addr: 'localhost:8787' } },
      { public_url: 'https://legacy.ngrok.app', config: { addr: 'localhost:8787' } },
    ],
  }, target), 'https://legacy.ngrok.app');
});

test('extracts ngrok HTTPS URLs from log output', () => {
  assert.equal(extractNgrokUrl('url=https://abc-123.ngrok-free.app addr=http://localhost:8787'), 'https://abc-123.ngrok-free.app');
  assert.equal(extractNgrokUrl('no url here'), null);
});

test('builds ngrok command args for local listener and reserved URLs', () => {
  const { args, runtimeConfig } = buildNgrokArgs({
    host: '0.0.0.0',
    port: 8787,
    ngrokUrl: 'https://figma-hooks.ngrok.app',
  });
  try {
    assert.deepEqual(args, [
      'http',
      'http://127.0.0.1:8787',
      '--url',
      'https://figma-hooks.ngrok.app',
    ]);
  } finally {
    runtimeConfig.cleanup();
  }
});
