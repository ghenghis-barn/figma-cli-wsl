/**
 * Platform-specific helpers.
 * Only defines functions for the current platform — no Windows code loaded on Mac, etc.
 */

import { execFileSync, execSync, spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PLATFORM = process.platform;
let wslCdpTunnelLastAttempt = 0;

// --- Null device ---
export const nullDevice = PLATFORM === 'win32' ? 'NUL' : '/dev/null';

// --- Port cleanup ---
function killPortUnix(port) {
  const portCheck = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf8', stdio: 'pipe' });
  if (portCheck.trim()) {
    try { execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'pipe' }); } catch {}
    try { execSync('sleep 0.3', { stdio: 'pipe' }); } catch {}
  }
}

function killPortWindows(port) {
  try {
    const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: 'pipe' });
    const lines = result.split('\n').filter(l => l.includes('LISTENING'));
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        execSync(`taskkill /PID ${pid} /F 2>nul`, { stdio: 'pipe' });
      }
    }
    try { execSync('ping -n 1 127.0.0.1 >nul', { stdio: 'pipe' }); } catch {}
  } catch {}
}

export const killPort = PLATFORM === 'win32' ? killPortWindows : killPortUnix;

// --- Get PID listening on port ---
function getPortPidUnix(port) {
  return execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf8', stdio: 'pipe' }).trim() || null;
}

function getPortPidWindows(port) {
  const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: 'pipe' });
  const line = result.split('\n').find(l => l.includes('LISTENING'));
  if (line) {
    const parts = line.trim().split(/\s+/);
    return parts[parts.length - 1] || null;
  }
  return null;
}

export const getPortPid = PLATFORM === 'win32' ? getPortPidWindows : getPortPidUnix;

// --- Sleep after daemon stop ---
export function sleepAfterStop() {
  if (PLATFORM === 'win32') {
    try { execSync('ping -n 2 127.0.0.1 >nul', { stdio: 'pipe' }); } catch {}
  } else {
    try { execSync('sleep 0.5', { stdio: 'pipe' }); } catch {}
  }
}

// --- WSL detection / Windows path helpers ---
export function isWsl() {
  if (PLATFORM !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function runPowerShell(command, options = {}) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).replace(/\r/g, '').trim();
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsPathToWslPath(path) {
  const match = String(path).match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return path;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function wslPathToWindowsPath(path) {
  const match = String(path).match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) return path;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function getWindowsLocalAppDataFromWsl() {
  try {
    return runPowerShell('$env:LOCALAPPDATA');
  } catch {
    return null;
  }
}

function getWindowsUserProfileFromWsl() {
  try {
    return runPowerShell('$env:USERPROFILE');
  } catch {
    return null;
  }
}

function findWindowsFigmaBaseWsl() {
  const localAppData = getWindowsLocalAppDataFromWsl();
  if (!localAppData) return null;
  const figmaBase = windowsPathToWslPath(`${localAppData}\\Figma`);
  return existsSync(figmaBase) ? figmaBase : null;
}

function findWindowsFigmaAsarWsl() {
  const figmaBase = findWindowsFigmaBaseWsl();
  if (!figmaBase) return null;

  try {
    const appFolders = readdirSync(figmaBase)
      .filter(e => e.startsWith('app-'))
      .sort()
      .reverse();

    for (const folder of appFolders) {
      const asarPath = join(figmaBase, folder, 'resources', 'app.asar');
      if (existsSync(asarPath)) return asarPath;
    }

    const oldPath = join(figmaBase, 'resources', 'app.asar');
    if (existsSync(oldPath)) return oldPath;
  } catch {}

  return null;
}

function findWindowsFigmaExeWsl() {
  const figmaBase = findWindowsFigmaBaseWsl();
  if (!figmaBase) return null;

  const mainExe = join(figmaBase, 'Figma.exe');
  if (existsSync(mainExe)) return mainExe;

  try {
    const appFolders = readdirSync(figmaBase)
      .filter(e => e.startsWith('app-'))
      .sort()
      .reverse();

    for (const folder of appFolders) {
      const exePath = join(figmaBase, folder, 'Figma.exe');
      if (existsSync(exePath)) return exePath;
    }
  } catch {}

  return null;
}

function canReachCdp(port) {
  try {
    execSync(`curl -fsS --max-time 0.5 http://127.0.0.1:${port}/json/version`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return true;
  } catch {
    return false;
  }
}

function getWslIpForWindows() {
  try {
    const out = execSync('hostname -I', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const ip = out.split(/\s+/).find(v => /^\d+\.\d+\.\d+\.\d+$/.test(v) && !v.startsWith('127.'));
    if (ip) return ip;
  } catch {}

  try {
    const out = execSync('ip -4 addr show eth0', { encoding: 'utf8', stdio: 'pipe' });
    const match = out.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\//);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getWslSshTarget() {
  if (process.env.FIGMA_WSL_SSH_TARGET) return process.env.FIGMA_WSL_SSH_TARGET;
  const ip = getWslIpForWindows();
  return `${process.env.USER || 'ubuntu'}@${ip || 'localhost'}`;
}

function waitForCdp(port, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (canReachCdp(port)) return true;
    try { execSync('sleep 0.15', { stdio: 'ignore' }); } catch {}
  }
  return false;
}

function buildWindowsSshReverseTunnelCommand(port) {
  const target = getWslSshTarget();
  const localPort = getLocalCdpPort(port);
  const reverse = `127.0.0.1:${localPort}:127.0.0.1:${port}`;
  const args = [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-R', reverse,
    target
  ];
  const userProfile = getWindowsUserProfileFromWsl();
  if (userProfile) {
    const keyPath = `${userProfile}\\.ssh\\figma_cli_wsl_ed25519`;
    if (existsSync(windowsPathToWslPath(keyPath))) {
      const reverseIndex = args.indexOf('-R');
      args.splice(reverseIndex >= 0 ? reverseIndex : args.length - 2, 0, '-i', keyPath);
    }
  }
  const psArgs = args.map(psQuote).join(', ');
  return `Start-Process -FilePath 'ssh.exe' -ArgumentList @(${psArgs}) -WindowStyle Hidden`;
}

function getLocalCdpPort(port) {
  return parseInt(process.env.FIGMA_CDP_PORT || String(port), 10);
}

export function getCdpHost() {
  return process.env.FIGMA_CDP_HOST || '127.0.0.1';
}

export function getCdpUrl(port) {
  return `http://${getCdpHost()}:${getLocalCdpPort(port)}`;
}

export function rewriteCdpWebSocketUrl(wsUrl, port) {
  const host = getCdpHost();
  const localPort = getLocalCdpPort(port);
  try {
    const url = new URL(wsUrl);
    url.hostname = host;
    url.port = String(localPort);
    return url.toString();
  } catch {
    return wsUrl;
  }
}

export function getCdpBridgeCommand(port) {
  if (!isWsl()) return null;
  const target = getWslSshTarget();
  return `powershell.exe -NoProfile -Command "${buildWindowsSshReverseTunnelCommand(port).replace(/"/g, '\\"')}"  # target: ${target}`;
}

export function ensureCdpBridge(port) {
  if (!isWsl()) return true;
  if (process.env.FIGMA_WSL_CDP_TUNNEL === '0') return false;
  if (canReachCdp(getLocalCdpPort(port))) return true;

  const now = Date.now();
  if (now - wslCdpTunnelLastAttempt < 5000) return false;
  wslCdpTunnelLastAttempt = now;

  try {
    spawn('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command',
      buildWindowsSshReverseTunnelCommand(port)
    ], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    return false;
  }

  return waitForCdp(getLocalCdpPort(port));
}

// --- Start Figma ---
export function startFigmaApp(figmaPath, port) {
  if (PLATFORM === 'darwin') {
    execSync(`open -a Figma --args --remote-debugging-port=${port}`, { stdio: 'pipe' });
  } else if (isWsl()) {
    const windowsPath = wslPathToWindowsPath(figmaPath || findWindowsFigmaExeWsl() || '');
    if (!windowsPath) throw new Error('Cannot detect Windows Figma.exe from WSL');
    const command = `Start-Process -FilePath ${psQuote(windowsPath)} -ArgumentList ${psQuote(`--remote-debugging-port=${port}`)}`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'ignore' });
  } else {
    spawn(figmaPath, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' }).unref();
  }
}

// --- Kill Figma ---
export function killFigmaApp() {
  try {
    if (PLATFORM === 'darwin') {
      execSync('pkill -x Figma 2>/dev/null || true', { stdio: 'pipe' });
    } else if (isWsl()) {
      execSync('cmd.exe /c taskkill /IM Figma.exe /F 2>nul', { stdio: 'pipe' });
    } else if (PLATFORM === 'win32') {
      execSync('taskkill /IM Figma.exe /F 2>nul', { stdio: 'pipe' });
    } else {
      execSync('pkill -x figma 2>/dev/null || true', { stdio: 'pipe' });
    }
  } catch {}
}

// --- Figma paths (asar, binary, command) ---

// Windows-only helpers (only defined on Windows)
let findWindowsFigmaPath, findWindowsFigmaExe;

if (PLATFORM === 'win32') {
  findWindowsFigmaPath = function() {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;

    const figmaBase = join(localAppData, 'Figma');
    if (!existsSync(figmaBase)) return null;

    try {
      const entries = readdirSync(figmaBase);
      const appFolders = entries
        .filter(e => e.startsWith('app-'))
        .sort()
        .reverse();

      for (const folder of appFolders) {
        const asarPath = join(figmaBase, folder, 'resources', 'app.asar');
        if (existsSync(asarPath)) return asarPath;
      }

      const oldPath = join(figmaBase, 'resources', 'app.asar');
      if (existsSync(oldPath)) return oldPath;
    } catch {}

    return null;
  };

  findWindowsFigmaExe = function() {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;

    const figmaBase = join(localAppData, 'Figma');
    const mainExe = join(figmaBase, 'Figma.exe');
    if (existsSync(mainExe)) return mainExe;

    try {
      const entries = readdirSync(figmaBase);
      const appFolders = entries
        .filter(e => e.startsWith('app-'))
        .sort()
        .reverse();

      for (const folder of appFolders) {
        const exePath = join(figmaBase, folder, 'Figma.exe');
        if (existsSync(exePath)) return exePath;
      }
    } catch {}

    return null;
  };
}

const ASAR_PATHS = {
  darwin: '/Applications/Figma.app/Contents/Resources/app.asar',
  linux: '/opt/figma/resources/app.asar'
};

export function getAsarPath() {
  if (isWsl()) return findWindowsFigmaAsarWsl();
  if (PLATFORM === 'win32') return findWindowsFigmaPath();
  return ASAR_PATHS[PLATFORM] || null;
}

export function getFigmaBinaryPath() {
  switch (PLATFORM) {
    case 'darwin':
      return '/Applications/Figma.app/Contents/MacOS/Figma';
    case 'win32':
      return findWindowsFigmaExe() || `${process.env.LOCALAPPDATA}\\Figma\\Figma.exe`;
    case 'linux':
      if (isWsl()) return findWindowsFigmaExeWsl();
      return '/usr/bin/figma';
    default:
      return null;
  }
}

export function getFigmaCommand(port = 9222) {
  switch (PLATFORM) {
    case 'darwin':
      return `open -a Figma --args --remote-debugging-port=${port}`;
    case 'win32': {
      const exePath = findWindowsFigmaExe();
      if (exePath) return `"${exePath}" --remote-debugging-port=${port}`;
      return `"%LOCALAPPDATA%\\Figma\\Figma.exe" --remote-debugging-port=${port}`;
    }
    case 'linux':
      if (isWsl()) {
        const exePath = findWindowsFigmaExeWsl();
        const windowsPath = exePath ? wslPathToWindowsPath(exePath) : '$env:LOCALAPPDATA\\Figma\\Figma.exe';
        return `powershell.exe -NoProfile -Command "Start-Process -FilePath '${windowsPath}' -ArgumentList '--remote-debugging-port=${port}'"`;
      }
      return `figma --remote-debugging-port=${port}`;
    default:
      return null;
  }
}

// --- Doctor helpers ---
export function getFigmaVersion() {
  if (PLATFORM === 'darwin') {
    return execSync('defaults read /Applications/Figma.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null', { encoding: 'utf8' }).trim();
  } else if (PLATFORM === 'win32') {
    return execSync('powershell -command "(Get-Item \\"$env:LOCALAPPDATA\\Figma\\Figma.exe\\").VersionInfo.ProductVersion" 2>nul', { encoding: 'utf8' }).trim() || 'unknown';
  } else if (isWsl()) {
    return runPowerShell('(Get-Item "$env:LOCALAPPDATA\\Figma\\Figma.exe").VersionInfo.ProductVersion') || 'unknown';
  }
  return 'unknown';
}

export function isFigmaRunning() {
  if (isWsl()) {
    const ps = execSync('cmd.exe /c tasklist /FI "IMAGENAME eq Figma.exe" 2>nul', { encoding: 'utf8' });
    return ps.includes('Figma.exe');
  }
  if (PLATFORM === 'darwin' || PLATFORM === 'linux') {
    const ps = execSync('pgrep -f Figma 2>/dev/null || true', { encoding: 'utf8' });
    return ps.trim().length > 0;
  } else if (PLATFORM === 'win32') {
    const ps = execSync('tasklist /FI "IMAGENAME eq Figma.exe" 2>nul', { encoding: 'utf8' });
    return ps.includes('Figma.exe');
  }
  return false;
}

export const platformName = isWsl()
  ? 'WSL'
  : ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[PLATFORM] || PLATFORM);
