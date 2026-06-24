# Using figma-cli

figma-cli controls Figma Desktop directly. Open Figma Desktop, then run
`figma-cli connect` once per session before trying to read or change the canvas.

## Golden Rules

1. Create frames with `render` / `render-batch`; they have smart positioning.
   Do not use `eval` to create new visual nodes because it bypasses positioning
   and safety guards.
2. Use frames for structural surfaces. Cards, panels, tags, pills, callouts,
   bottom bands and page or slide backgrounds should be frames with fills and
   strokes, not standalone rectangles behind content. Use the parent frame fill
   for a full-page background. Rectangles are fine for simple decorative bars,
   dividers, progress segments or literal vector geometry.
3. "N buttons/cards" means N separate top-level nodes, not one wrapper frame
   containing N children. Use `render-batch '[...]'` or
   `figma-cli shadcn add <component> --count N`.
4. Never delete the user's existing nodes unless they explicitly ask for it.
5. After creating or materially editing canvas content, verify with
   `figma-cli verify "<id>" --measure`. Save screenshots to `/tmp` when useful.

## Layout Hierarchy

- Prefer structured Auto Layout for UI hierarchy wherever practical. Use
  `flex="row"` / `flex="col"`, `gap`, padding, `w="fill"`, `w="hug"` and
  alignment props so Figma owns spacing, wrapping and resizing.
- Use regular frames for meaningful containers, surfaces and grouping even when
  their children need manual placement. Frames should carry fills, strokes,
  clipping and naming instead of relying on loose background shapes.
- Use absolute positioning only when precision placement is the point of the
  artifact, such as diagrams, illustrations, charts, annotations, overlays or
  intentionally layered compositions. Do not use manual `x`/`y` placement for
  ordinary cards, lists, forms, nav, tables or page structure when Auto Layout
  can express the relationship.
- For directional arrows and flow diagrams, use native Figma line/arrow
  primitives (`figma.createLine()`, line caps or CLI line helpers), not text
  glyph arrows or a line-plus-text-field workaround. Preserve existing
  manually drawn native arrows unless the user asks to restyle them. In FigJam,
  prefer native connectors when available.
- When editing existing canvas content, preserve intentional absolute layouts
  for diagrammatic or illustrative regions, but convert routine UI stacks and
  repeated rows/cards to Auto Layout where it improves maintainability.

## Editing Existing Figma Files

- If an existing rectangle is acting as a background/container for text or child
  UI, convert it to a frame where practical, preserving fills, strokes, size and
  absolute position. Reparent the related text/children into that frame so the
  layer hierarchy matches the visual structure.
- Do not convert purely decorative rectangles such as thin chapter indicators,
  dividers, chart bars or other literal shapes unless they need to contain other
  nodes.
- `eval` is acceptable for mutating existing nodes or making hierarchy fixes
  when no safer CLI command exists. Keep it scoped and verify the result.

## Design Tokens / Variables

- Bind colors at creation with `var:name` when a design system is loaded.
- Pin a named collection when the user names one:
  `figma-cli render-batch ... --collection figma`.
- Import a system with `figma-cli import tailwind.config.js`,
  `figma-cli import globals.css`, or `figma-cli import tokens.json`.
- Export the open file's system with `figma-cli extract`.

## Render Cheatsheet

- Layout: `flex="row|col" gap={16} p={24} px py pt pr pb pl`
- Size: `w={320} h={200} w="fill" w="hug" w="60%"`
- Look: `bg="#fff" stroke="#000" strokeWidth={2} rounded={12}`
- Text: `<Text size={14} weight="semibold" color="#000" lineHeight={20} w="fill">`
- Icons: `<Icon name="lucide:home" size={20} color="var:primary" />`

For text to wrap, the parent and every `Text` node need `w="fill"`, and the
parent should use `flex="col"` or `flex="row"`.

## Handy Commands

```bash
figma-cli connect
figma-cli canvas info
figma-cli render '<Frame>...</Frame>'
figma-cli render-batch '[ "<Frame>...</Frame>", "<Frame>...</Frame>" ]' --direction row
figma-cli shadcn add button --count 3
figma-cli node to-component "<id>"
figma-cli verify "<id>" --measure
figma-cli a11y audit
```

## Cloud Comments / Webhooks

- Comments and webhooks live in Figma's hosted collaboration layer, so use the
  REST-backed `figma-cli comments` / `figma-cli webhooks` commands rather than
  the local canvas/plugin path.
- For live webhook delivery, prefer
  `figma-cli webhooks watch --tunnel-provider ngrok --register ...`. ngrok is
  more suitable than localtunnel for end-to-end tests because the CLI can read
  the local ngrok Agent API, verify the public `/health` route, and then
  register the exact endpoint with Figma.
- localtunnel is still available through `--tunnel` or
  `--tunnel-provider localtunnel`, but treat it as a fallback. If Figma shows
  408/timeout delivery attempts, switch to ngrok before changing webhook code.
- Store ngrok auth outside command arguments: use `ngrok config add-authtoken`,
  `NGROK_AUTHTOKEN`, or `figma-cli config set ngrokAuthtoken <token>`; config
  output redacts token-like values by default. If ngrok is installed outside
  `PATH`, persist the binary path with `figma-cli config set ngrokBin <path>`.
- When testing a webhook path, use `--events-file` for a durable JSONL log,
  `--once --delete-on-stop` for temporary registered hooks, and
  `figma-cli webhooks requests <id>` to distinguish Figma delivery failures
  from local listener failures. A valid smoke test receives `PING`, then a
  non-PING event such as `FILE_COMMENT`, then cleans up the registered webhook.
