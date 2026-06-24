import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir, homedir, platform } from 'os';
import { join } from 'path';
import localtunnel from 'localtunnel';

const DEFAULT_NGROK_API_PORT = 4040;
const DEFAULT_TUNNEL_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTunnelProvider(provider = 'localtunnel') {
  const value = String(provider).toLowerCase();
  if (value === 'localtunnel' || value === 'lt') return 'localtunnel';
  if (value === 'ngrok') return 'ngrok';
  throw new Error(`Unsupported tunnel provider "${provider}". Use localtunnel or ngrok.`);
}

function localHostForTunnel(host) {
  if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host;
}

function appendTunnelPath(baseUrl, path = '/') {
  const cleanBase = String(baseUrl).replace(/\/+$/, '');
  const cleanPath = String(path || '/');
  return `${cleanBase}${cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`}`;
}

function healthUrlForTunnel(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = '/health';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function defaultNgrokConfigPath() {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'ngrok', 'ngrok.yml');
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(localAppData, 'ngrok', 'ngrok.yml');
  }
  return join(home, '.config', 'ngrok', 'ngrok.yml');
}

function normalizeApiBase(urlOrPort) {
  if (!urlOrPort) return `http://127.0.0.1:${DEFAULT_NGROK_API_PORT}/api`;
  const text = String(urlOrPort);
  const base = text.startsWith('http')
    ? text
    : /^\d+$/.test(text)
      ? `http://127.0.0.1:${text}`
      : `http://${text}`;
  return base.replace(/\/+$/, '').endsWith('/api')
    ? base.replace(/\/+$/, '')
    : `${base.replace(/\/+$/, '')}/api`;
}

function redact(text, secrets = []) {
  let out = String(text || '');
  for (const secret of secrets.filter(Boolean)) {
    out = out.split(secret).join('<redacted>');
  }
  return out;
}

function extractNgrokUrl(text) {
  const match = String(text || '').match(/https:\/\/[^\s"'<>]+\.ngrok[^\s"'<>]*/i);
  return match ? match[0].replace(/[),.;]+$/, '') : null;
}

async function fetchJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function candidateMatchesTarget(candidate, target) {
  if (!target) return false;
  const targetUrl = new URL(target);
  const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80');
  const targetHost = targetUrl.hostname;
  const upstream = [
    candidate.config?.addr,
    candidate.upstream?.url,
    candidate.upstream?.addr,
  ].filter(Boolean).join(' ');
  return upstream.includes(targetPort) && (
    upstream.includes(targetHost)
    || upstream.includes('localhost')
    || upstream.includes('127.0.0.1')
    || /^\d+$/.test(upstream.trim())
  );
}

function selectNgrokPublicUrl(payload = {}, target) {
  const endpoints = Array.isArray(payload.endpoints) ? payload.endpoints : [];
  const tunnels = Array.isArray(payload.tunnels) ? payload.tunnels : [];
  const candidates = [
    ...endpoints.map((endpoint) => ({
      url: endpoint.url,
      upstream: endpoint.upstream,
      config: endpoint.config,
    })),
    ...tunnels.map((tunnel) => ({
      url: tunnel.public_url,
      upstream: tunnel.upstream,
      config: tunnel.config,
    })),
  ].filter((candidate) => typeof candidate.url === 'string' && candidate.url.startsWith('https://'));

  return (candidates.find((candidate) => candidateMatchesTarget(candidate, target)) || candidates[0])?.url || null;
}

async function readNgrokAgentUrl(apiBase, target) {
  const payload = {};
  try {
    const endpoints = await fetchJson(`${apiBase}/endpoints`);
    payload.endpoints = endpoints.endpoints;
  } catch {
    // Older agents expose tunnels rather than endpoints.
  }
  try {
    const tunnels = await fetchJson(`${apiBase}/tunnels`);
    payload.tunnels = tunnels.tunnels;
  } catch {
    // The endpoint API is preferred when present.
  }
  return selectNgrokPublicUrl(payload, target);
}

async function waitForTunnelHealth(baseUrl, timeoutMs = DEFAULT_TUNNEL_TIMEOUT_MS) {
  const started = Date.now();
  const healthUrl = healthUrlForTunnel(baseUrl);
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return true;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw new Error(`Tunnel did not reach local listener health endpoint (${healthUrl}): ${lastError?.message || 'timeout'}`);
}

function writeNgrokRuntimeConfig(options = {}) {
  const needsRuntimeConfig = options.ngrokApiPort || options.ngrokApiUrl || options.ngrokRuntimeConfig;
  if (!needsRuntimeConfig) return { configArg: options.ngrokConfig || null, cleanup: () => {} };

  const webAddr = options.ngrokApiUrl
    ? new URL(normalizeApiBase(options.ngrokApiUrl).replace(/\/api$/, '')).host
    : `127.0.0.1:${options.ngrokApiPort || DEFAULT_NGROK_API_PORT}`;
  const dir = mkdtempSync(join(tmpdir(), 'figma-cli-ngrok-'));
  const configPath = join(dir, 'ngrok.yml');
  writeFileSync(configPath, [
    'version: 3',
    'agent:',
    '  console_ui: false',
    '  log: stdout',
    '  log_format: logfmt',
    `  web_addr: ${webAddr}`,
    '',
  ].join('\n'), { mode: 0o600 });

  const configs = [];
  const defaultConfig = defaultNgrokConfigPath();
  if (options.ngrokConfig) configs.push(options.ngrokConfig);
  else if (existsSync(defaultConfig)) configs.push(defaultConfig);
  configs.push(configPath);

  return {
    configArg: configs.join(','),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function ngrokAuthtoken(config = {}) {
  return process.env.NGROK_AUTHTOKEN
    || config.ngrokAuthtoken
    || config.ngrokAuthToken
    || config.ngrokToken
    || null;
}

function buildNgrokArgs(options = {}) {
  const target = `http://${localHostForTunnel(options.host)}:${Number(options.port)}`;
  const runtimeConfig = writeNgrokRuntimeConfig(options);
  const args = ['http', target];
  if (options.ngrokUrl) args.push('--url', options.ngrokUrl);
  if (runtimeConfig.configArg) args.push('--config', runtimeConfig.configArg);
  return { args, runtimeConfig, target };
}

async function startNgrokTunnel(options = {}, config = {}) {
  const timeoutMs = Number(options.tunnelTimeout || DEFAULT_TUNNEL_TIMEOUT_MS);
  const apiBase = normalizeApiBase(options.ngrokApiUrl || options.ngrokApiPort || DEFAULT_NGROK_API_PORT);
  const authtoken = ngrokAuthtoken(config);
  const { args, runtimeConfig, target } = buildNgrokArgs(options);
  const binary = options.ngrokBin || config.ngrokBin || 'ngrok';
  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(authtoken ? { NGROK_AUTHTOKEN: authtoken } : {}),
    },
  });
  const emitter = new EventEmitter();
  const secrets = [authtoken].filter(Boolean);
  let output = '';
  let outputUrl = null;
  let exited = false;
  let spawnError = null;

  const capture = (chunk) => {
    const text = chunk.toString();
    output += text;
    output = output.slice(-4000);
    outputUrl ||= extractNgrokUrl(text);
  };

  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (error) => {
    spawnError = error;
  });
  child.on('exit', (code, signal) => {
    exited = true;
    emitter.emit('close', { code, signal });
  });

  try {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (spawnError) {
        if (spawnError.code === 'ENOENT') {
          throw new Error('ngrok executable was not found on PATH. Install ngrok or pass --ngrok-bin <path>.');
        }
        throw spawnError;
      }
      if (exited) {
        throw new Error(`ngrok exited before creating a tunnel: ${redact(output, secrets).trim() || 'no output'}`);
      }
      const apiUrl = await readNgrokAgentUrl(apiBase, target).catch(() => null);
      const url = apiUrl || outputUrl;
      if (url) {
        return {
          provider: 'ngrok',
          url,
          process: child,
          on: emitter.on.bind(emitter),
          close: () => {
            if (!child.killed) child.kill('SIGTERM');
            runtimeConfig.cleanup();
          },
        };
      }
      await sleep(500);
    }
    throw new Error(`Timed out waiting for ngrok public URL from ${apiBase}. Recent output: ${redact(output, secrets).trim() || 'none'}`);
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    runtimeConfig.cleanup();
    throw error;
  }
}

async function startLocalTunnel(options = {}) {
  const tunnel = await localtunnel({
    port: Number(options.port),
    local_host: localHostForTunnel(options.host),
    subdomain: options.subdomain || undefined,
    host: options.tunnelHost || undefined,
  });

  return {
    provider: 'localtunnel',
    url: tunnel.url,
    on: tunnel.on.bind(tunnel),
    close: tunnel.close.bind(tunnel),
  };
}

async function startPublicTunnel(options = {}, config = {}) {
  const provider = normalizeTunnelProvider(options.tunnelProvider || 'localtunnel');
  if (provider === 'ngrok') return startNgrokTunnel(options, config);
  return startLocalTunnel(options);
}

export {
  appendTunnelPath,
  buildNgrokArgs,
  DEFAULT_NGROK_API_PORT,
  DEFAULT_TUNNEL_TIMEOUT_MS,
  extractNgrokUrl,
  healthUrlForTunnel,
  localHostForTunnel,
  normalizeApiBase,
  normalizeTunnelProvider,
  selectNgrokPublicUrl,
  startNgrokTunnel,
  startLocalTunnel,
  startPublicTunnel,
  waitForTunnelHealth,
};
