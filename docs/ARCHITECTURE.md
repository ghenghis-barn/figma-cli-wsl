# Architecture

## How figma-ds-cli Works

```
┌─────────────────┐      Chrome DevTools      ┌─────────────────┐
│  figma-ds-cli   │ ◄────── Protocol ───────► │  Figma Desktop  │
│     (CLI)       │      (localhost:9222)     │                 │
└─────────────────┘                           └─────────────────┘
```

In WSL-on-Windows, the same CDP link uses a split-port bridge:

```
WSL CLI → 127.0.0.1:39222 → Windows reverse SSH tunnel → Windows Figma 127.0.0.1:9222
```

### Technology Stack

1. **Chrome DevTools Protocol (CDP)**: Figma Desktop is an Electron app with a Chromium runtime. We connect via CDP on port 9222. In WSL, Figma still listens on Windows port 9222, but the Linux side of the bridge defaults to port 39222 to avoid WSL localhost relay collisions.

2. **figma-use**: The underlying library that handles CDP connection and JavaScript execution. Our CLI wraps this.

3. **Figma Plugin API**: We execute JavaScript against the global `figma` object, which provides full access to the Figma Plugin API.

4. **Figma REST API for hosted collaboration state**: Comments and webhooks are
   not part of the local canvas/plugin runtime. They live in Figma's hosted
   collaboration layer, so `src/figma-rest.js` uses the official REST API for
   comment reads/writes and webhook management.

### Connection Flow

1. User runs `figma-ds-cli connect`
2. CLI patches Figma to enable remote debugging (adds `--remote-debugging-port=9222` flag)
3. Figma restarts with debugging enabled
4. CLI connects via WebSocket to `localhost:9222`, or to the WSL bridge port `localhost:39222` when Figma is running on Windows
5. Commands are executed as JavaScript in Figma's context

### WSL CDP Bridge Invariant

Do not bind both sides of the WSL bridge to `9222`. Windows Figma must own Windows `127.0.0.1:9222`; WSL should use a separate local port, currently `39222`, and forward that to Windows `9222`.

If the bridge uses `-R 127.0.0.1:9222:127.0.0.1:9222`, WSL's localhost relay can appear on Windows as the listener for `9222`. Figma then launches with `--remote-debugging-port=9222` but cannot serve CDP there, and CLI probes see hangs or empty replies from `/json/version`.

The saved `config.patched` flag is only advisory. Figma auto-updates can replace `app.asar`, so Yolo connection setup must recheck the active install with `isPatched()` before deciding whether to skip patching.

### Key Files

```
figma-cli/
├── src/
│   ├── index.js          # Entry point: imports lib + command modules, program.parse()
│   ├── lib/cli-core.js   # Shared core: daemon plumbing, eval helpers, config, program
│   ├── commands/         # One module per command group (setup, variables, tokens,
│   │                     # render, a11y, slots, variants, ... 18 modules)
│   ├── figma-client.js   # JSX parser + Figma Plugin API code generator
│   └── daemon.js         # Background daemon (CDP + plugin WebSocket bridge)
├── package.json      # npm package config
├── README.md         # User documentation
└── docs/             # Technical documentation
```

### No API Key Required

For local canvas creation and inspection, unlike the Figma REST API which requires authentication, we use the Plugin API directly through the desktop app. This means:

- Full read/write access to everything
- No rate limits
- Access to features not available in REST API (like variable modes)
- Works with the user's existing Figma session

Cloud-backed features are the exception. File comments and webhooks require a
Figma REST token because the Figma Plugin API does not expose that hosted
collaboration state.

### Cloud Comments and Webhooks

`src/commands/comments-webhooks.js` adds first-class commands for:

- reading, creating and deleting file comments
- creating, listing, deleting and inspecting Figma Webhooks V2 registrations
- running a child-process HTTP listener that streams validated events back to
  the parent CLI process

For live delivery tests, the supported tunnel path is:

```
Figma Webhooks V2 → ngrok HTTPS endpoint → local /figma-webhook listener → parent CLI IPC
```

The watcher can start ngrok, discover the public URL from the local ngrok Agent
API, verify public `/health`, register the exact endpoint with Figma, log
events to JSONL, and delete temporary webhooks on stop. localtunnel remains
available as a lightweight fallback, but ngrok is the default operational choice
for reliable end-to-end webhook testing.

### Limitations

- macOS only (for now)
- Requires Figma Desktop (not web)
- One Figma instance at a time
- Some eval commands don't return output (but still execute)
