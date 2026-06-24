# Changelog

## Unreleased

### New

- Cloud-backed `comments` and `webhooks` command groups for Figma REST comments
  and Webhooks V2.
- `webhooks watch` can run a local receiver subprocess, open an ngrok or
  localtunnel HTTPS tunnel, auto-register the Figma webhook, verify public
  `/health`, stream events, persist JSONL logs, and clean up temporary webhooks
  with `--once --delete-on-stop`.
- Configured token-like values are redacted by default in `figma-cli config get`.

### Changed

- WSL CDP bridge setup now cleans stale reverse SSH listeners, uses a distinct
  local bridge port, and can provision a Windows-originated SSH key for the
  reverse tunnel path.

## 1.2.0 (2026-06-10)

### New

- **Unknown-prop warnings:** `render` and `render-batch` now warn about unknown JSX props before rendering, with a suggestion (`⚠ Unknown prop "cornerRadius" on <Frame>, did you mean "rounded"?`). Typos are detected too.
- **`justify="between"`** now works on root and nested frames (maps to SPACE_BETWEEN). The grow-spacer workaround is no longer needed.
- **Custom fonts in JSX:** `<Text font="Playfair Display" weight="light" italic={true}>` with the full weight scale (thin, extralight, light, regular, medium, semibold, bold, extrabold, black) and italic variants. Missing fonts fall back to Inter automatically.
- **Unresolved variable warnings in single render:** `render` now reports `var:` references that did not resolve (parity with `render-batch`).
- **`figma-cli undo`:** removes exactly the node(s) created by the most recent render / render-batch.
- **`render --verify` / `render-batch --verify`:** returns a screenshot of the result in the same call (saves PNG, prints JSON), replacing a separate verify roundtrip.
- **Native Figma effects in JSX:** `noise` (film grain), `texture` (paper grain), `progressiveBlur`, `glass` (Apple-style liquid glass). `gradient mesh` gains `--grain` and `--texture`.

### Changed

- `src/index.js` (10.7k lines) split into `src/lib/cli-core.js` and 18 command modules under `src/commands/`.
- Single render and render-batch share one child generator: batch now supports Icon, Rect, Image, Instance and Slot children, absolute positioning, wrap, strokeWidth and grow (previously dropped silently).
- All user input interpolated into generated plugin code is JSON-escaped: names like `Brand's Colors` no longer break rendering.
- Daemon: 400 on malformed JSON, no blind retry when the connection is healthy (prevents duplicate frames after timeouts), reconnect with backoff and health check.
- `npx figma-ds-cli` installs both `figma-ds-cli` and `figma-cli` binaries.

### Fixed

- `hexToRgb` returns null for invalid hex instead of NaN (no more silently black/broken fills).
- `status` no longer crashes on unpatched setups (called a nonexistent function).
- `figmaEvalSync` resolves figma-client.js relative to the install, not the working directory.

### Tests

- 14 → 105 unit tests (parser, color/gradient/shadow parsing, effects codegen, quoting, render-path parity, UX improvements). CI runs them on Node 18/20/22.
