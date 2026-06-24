import WebSocket from 'ws';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { FigmaClient } from './figma-client.js';

const FIGMA_API_BASE = 'https://api.figma.com';
const CONFIG_FILE = join(homedir(), '.figma-ds-cli', 'config.json');

function loadFigmaCliConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    // Ignore malformed or inaccessible config. Callers surface missing auth
    // with a focused token error instead.
  }
  return {};
}

function extractFileKey(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/figma\.com\/(?:design|file|board)\/([^/?#]+)/i);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(text)) return text;
  return null;
}

function fragmentText(fragments) {
  if (!Array.isArray(fragments)) return '';
  return fragments.map((fragment) => {
    if (typeof fragment?.text === 'string') return fragment.text;
    if (typeof fragment?.mention === 'string') return `@${fragment.mention}`;
    if (typeof fragment?.t === 'string') return fragment.t;
    return '';
  }).join('');
}

function normalizeComment(raw) {
  const message = raw.message
    || raw.text
    || raw.body
    || raw.content
    || fragmentText(raw.message_meta)
    || fragmentText(raw.comment)
    || '';

  return {
    id: raw.id || raw.comment_id || raw.uuid || null,
    file_key: raw.file_key || raw.key || null,
    parent_id: raw.parent_id || null,
    message,
    created_at: raw.created_at || raw.createdAt || null,
    updated_at: raw.updated_at || raw.updatedAt || null,
    resolved_at: raw.resolved_at || raw.resolvedAt || null,
    order_id: raw.order_id || raw.orderId || null,
    client_meta: raw.client_meta || raw.clientMeta || null,
    reactions: Array.isArray(raw.reactions) ? raw.reactions : [],
    user: raw.user ? {
      id: raw.user.id || raw.user.handle || null,
      handle: raw.user.handle || raw.user.name || null,
      name: raw.user.name || raw.user.handle || null,
    } : null,
  };
}

function normalizeCommentsResponse(payload) {
  const comments = Array.isArray(payload?.comments)
    ? payload.comments
    : Array.isArray(payload?.meta)
      ? payload.meta
      : Array.isArray(payload)
        ? payload
        : [];

  return comments.map(normalizeComment);
}

function getConfiguredToken() {
  const config = loadFigmaCliConfig();
  const oauthToken = process.env.FIGMA_OAUTH_TOKEN || config.figmaOAuthToken || config.figma_oauth_token;
  if (oauthToken) {
    return { type: 'oauth', value: oauthToken };
  }

  const personalToken = process.env.FIGMA_API_TOKEN
    || process.env.FIGMA_TOKEN
    || config.figmaApiToken
    || config.figmaToken
    || config.apiToken;
  if (personalToken) {
    return { type: 'personal', value: personalToken };
  }

  return null;
}

function buildAuthHeaders(token = getConfiguredToken()) {
  if (!token?.value) return {};
  if (token.type === 'oauth') {
    return { Authorization: `Bearer ${token.value}` };
  }
  return { 'X-Figma-Token': token.value };
}

async function figmaApiFetch(path, options = {}) {
  const token = options.token || getConfiguredToken();
  if (!token?.value) {
    throw new Error('Figma REST token is not configured. Set FIGMA_API_TOKEN, FIGMA_TOKEN, FIGMA_OAUTH_TOKEN, or figma-cli config set figmaApiToken <token>.');
  }

  const url = path.startsWith('http') ? path : `${FIGMA_API_BASE}${path}`;
  const headers = {
    ...buildAuthHeaders(token),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload
      ? payload.err || payload.message || payload.error || JSON.stringify(payload)
      : text || response.statusText;
    throw new Error(`Figma API ${response.status}: ${message}`);
  }

  return payload;
}

async function listOpenFigmaPages() {
  return FigmaClient.listPages();
}

async function resolveFileKey(input, options = {}) {
  const direct = extractFileKey(input || options.file || options.url || options.fileKey);
  if (direct) return direct;

  if (options.title) {
    const pages = await listOpenFigmaPages();
    const page = pages.find((p) => p.title.toLowerCase().includes(String(options.title).toLowerCase()));
    const key = extractFileKey(page?.url);
    if (key) return key;
    throw new Error(`No open Figma file matched title: ${options.title}`);
  }

  if (options.current !== false) {
    const pages = await listOpenFigmaPages().catch(() => []);
    const designPages = pages.filter((p) => /figma\.com\/(?:design|file|board)\//.test(p.url || ''));
    if (designPages.length === 1) {
      const key = extractFileKey(designPages[0].url);
      if (key) return key;
    }
    if (designPages.length > 1) {
      throw new Error('Multiple Figma files are open. Pass a file key/URL or --title to choose one.');
    }
  }

  throw new Error('Could not resolve a Figma file key. Pass a file key/URL or --title.');
}

function createCdpSender(ws) {
  let id = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  return (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}

async function fetchCommentsViaDesktop(fileKey, options = {}) {
  const pages = await listOpenFigmaPages();
  const page = pages.find((candidate) => {
    const candidateKey = extractFileKey(candidate.url);
    if (candidateKey === fileKey) return true;
    return options.title && candidate.title.toLowerCase().includes(String(options.title).toLowerCase());
  });
  if (!page) {
    throw new Error(`No authenticated Figma Desktop tab is open for file ${fileKey}.`);
  }

  const ws = new WebSocket(page.wsUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  const send = createCdpSender(ws);
  await send('Runtime.enable');
  const expression = `
(async () => {
  const url = 'https://www.figma.com/api/file/${fileKey}/comments';
  const response = await fetch(url, { credentials: 'include' });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_) {}
  return JSON.stringify({
    status: response.status,
    contentType: response.headers.get('content-type'),
    payload,
    text
  });
})()
`;
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  ws.close();

  if (result.result?.exceptionDetails) {
    const details = result.result.exceptionDetails;
    throw new Error(details.exception?.description || details.text || 'Figma Desktop comment fetch failed');
  }

  const data = JSON.parse(result.result.result.value);
  if (data.status < 200 || data.status >= 300) {
    throw new Error(`Figma Desktop comments endpoint ${data.status}: ${String(data.text || '').slice(0, 200)}`);
  }
  return normalizeCommentsResponse(data.payload);
}

async function listComments(fileKey, options = {}) {
  const source = options.source || 'auto';
  if (source === 'desktop') {
    return {
      source: 'desktop',
      comments: await fetchCommentsViaDesktop(fileKey, options),
    };
  }

  if (source === 'rest' || getConfiguredToken()) {
    const query = options.asMd ? '?as_md=true' : '';
    const payload = await figmaApiFetch(`/v1/files/${encodeURIComponent(fileKey)}/comments${query}`);
    return {
      source: 'rest',
      comments: normalizeCommentsResponse(payload),
    };
  }

  return {
    source: 'desktop',
    comments: await fetchCommentsViaDesktop(fileKey, options),
  };
}

async function postComment(fileKey, { message, commentId, clientMeta }) {
  const body = { message };
  if (commentId) body.comment_id = commentId;
  if (clientMeta) body.client_meta = clientMeta;
  const payload = await figmaApiFetch(`/v1/files/${encodeURIComponent(fileKey)}/comments`, {
    method: 'POST',
    body,
  });
  return normalizeComment(payload);
}

async function deleteComment(fileKey, commentId) {
  await figmaApiFetch(`/v1/files/${encodeURIComponent(fileKey)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
  return { id: commentId, deleted: true };
}

async function listWebhooks(options = {}) {
  const params = new URLSearchParams();
  if (options.context) params.set('context', options.context);
  if (options.contextId) params.set('context_id', options.contextId);
  if (options.planApiId) params.set('plan_api_id', options.planApiId);
  if (options.cursor) params.set('cursor', options.cursor);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return figmaApiFetch(`/v2/webhooks${suffix}`);
}

async function getWebhook(webhookId) {
  return figmaApiFetch(`/v2/webhooks/${encodeURIComponent(webhookId)}`);
}

async function createWebhook({ eventType, context, contextId, endpoint, passcode, status, description }) {
  const body = {
    event_type: eventType,
    context,
    context_id: contextId,
    endpoint,
    passcode,
  };
  if (status) body.status = status;
  if (description) body.description = description;
  return figmaApiFetch('/v2/webhooks', {
    method: 'POST',
    body,
  });
}

async function updateWebhook(webhookId, patch) {
  return figmaApiFetch(`/v2/webhooks/${encodeURIComponent(webhookId)}`, {
    method: 'PUT',
    body: patch,
  });
}

async function deleteWebhook(webhookId) {
  return figmaApiFetch(`/v2/webhooks/${encodeURIComponent(webhookId)}`, {
    method: 'DELETE',
  });
}

async function listWebhookRequests(webhookId) {
  return figmaApiFetch(`/v2/webhooks/${encodeURIComponent(webhookId)}/requests`);
}

function generatePasscode() {
  return randomBytes(24).toString('base64url');
}

function summarizeWebhookEvent(payload = {}) {
  const type = payload.event_type || 'UNKNOWN';
  const file = payload.file_name || payload.file_key || 'unknown file';
  if (type === 'FILE_COMMENT') {
    const text = fragmentText(payload.comment) || payload.message || '';
    const actor = payload.triggered_by?.handle || payload.triggered_by?.id || 'unknown user';
    return `${type} on ${file}: ${actor} commented "${text}"`;
  }
  if (type === 'PING') {
    return `PING webhook ${payload.webhook_id || ''}`.trim();
  }
  return `${type} on ${file}`;
}

export {
  buildAuthHeaders,
  createWebhook,
  deleteComment,
  deleteWebhook,
  extractFileKey,
  fetchCommentsViaDesktop,
  figmaApiFetch,
  fragmentText,
  generatePasscode,
  getConfiguredToken,
  getWebhook,
  listComments,
  listOpenFigmaPages,
  listWebhookRequests,
  listWebhooks,
  normalizeComment,
  normalizeCommentsResponse,
  postComment,
  resolveFileKey,
  summarizeWebhookEvent,
  updateWebhook,
};
