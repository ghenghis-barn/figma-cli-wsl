// Pure parser + conformance checker for the `## 6. Components` section of an
// extracted DESIGN.md. The CLI reads the markdown here (zero LLM tokens) and
// returns a COMPACT spec; `checkConformance` then HARD-enforces every
// instruction the md actually carries (variant axes, layout direction, gap,
// padding, child structure, sizes) against a built node — not just height.

const PAD_RE = /padding\s+(\d+)(?:\/(\d+)\/(\d+)\/(\d+))?px/;
const GAP_RE = /gap\s+(\d+)px/;

// Parse the "· horizontal row, gap 8px, padding 6/12/6/12px" meta segment that
// the extractor writes (see design-extract.js layoutDesc). Returns {lm,gap,pad}.
function parseLayoutMeta(seg) {
  const out = {};
  if (/horizontal row/.test(seg)) out.lm = 'HORIZONTAL';
  else if (/vertical stack/.test(seg)) out.lm = 'VERTICAL';
  const g = seg.match(GAP_RE);
  if (g) out.gap = Number(g[1]);
  const p = seg.match(PAD_RE);
  if (p) out.pad = p[2] !== undefined
    ? [Number(p[1]), Number(p[2]), Number(p[3]), Number(p[4])]   // T/R/B/L
    : [Number(p[1]), Number(p[1]), Number(p[1]), Number(p[1])];  // single value
  return out;
}

// Parse one bullet line into a node descriptor (no children yet).
function parseBullet(line) {
  const m = line.match(/^(\s*)-\s+\*\*(.+?)\*\*\s+·\s+`(\w+)`(.*)$/);
  if (!m) return null;
  const depth = Math.floor(m[1].length / 2);
  const node = { name: m[2].trim(), type: m[3], children: [] };
  const segs = m[4].split('·').map(s => s.trim()).filter(Boolean);
  for (const seg of segs) {
    const dim = seg.match(/^(\d+)×(\d+)$/);
    if (dim) { node.w = Number(dim[1]); node.h = Number(dim[2]); continue; }
    if (/horizontal row|vertical stack/.test(seg)) Object.assign(node, parseLayoutMeta(seg));
    // "N children", text, "instance of …" are not enforced structurally here.
  }
  return { depth, node };
}

// Build a tree from the bullet block that follows "Sample variant structure:".
function parseStructureTree(text) {
  const lines = text.split('\n');
  const stack = [];   // [{depth, node}]
  let root = null;
  for (const line of lines) {
    if (!/^\s*-\s+\*\*/.test(line)) { if (root) break; else continue; }
    const parsed = parseBullet(line);
    if (!parsed) continue;
    if (!root) { root = parsed.node; stack.push(parsed); continue; }
    while (stack.length && stack[stack.length - 1].depth >= parsed.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(parsed.node);
    stack.push(parsed);
  }
  return root;
}

/** Parse every component block out of a DESIGN.md string. */
export function parseComponentSpecs(md) {
  if (!md || typeof md !== 'string') return [];
  const lines = md.split('\n');
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) { if (cur) blocks.push(cur); cur = { name: h3[1].trim(), body: [] }; continue; }
    if (/^##\s+/.test(line)) { if (cur) { blocks.push(cur); cur = null; } continue; }
    if (cur) cur.body.push(line);
  }
  if (cur) blocks.push(cur);

  const specs = [];
  for (const b of blocks) {
    const body = b.body.join('\n');
    const vm = body.match(/·\s*(\d+)\s+variants?/i) || body.match(/^\s*Page:.*?(\d+)\s+variants?/im);
    if (!vm) continue;
    const pageM = body.match(/^\s*Page:\s*(.+?)\s*·/im);

    const axes = {};
    const tableRows = body.match(/^\|.*\|.*\|\s*$/gm) || [];
    for (const row of tableRows) {
      const cells = row.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1);
      if (cells.length < 2) continue;
      const [prop, vals] = cells;
      if (/^property$/i.test(prop) || /^-+$/.test(prop)) continue;
      axes[prop] = vals.split(',').map(v => v.trim()).filter(Boolean);
    }

    let sample = null;
    const sIdx = body.indexOf('Sample variant structure:');
    if (sIdx >= 0) sample = parseStructureTree(body.slice(sIdx + 'Sample variant structure:'.length));

    specs.push({ name: b.name, page: pageM ? pageM[1].trim() : null, variants: Number(vm[1]), axes, sample });
  }
  return specs;
}

/** Find one component spec by name: exact (case-insensitive) → prefix → substring. */
export function findComponentSpec(md, name) {
  const specs = parseComponentSpecs(md);
  if (!specs.length || !name) return null;
  const n = name.toLowerCase();
  return (
    specs.find(s => s.name.toLowerCase() === n) ||
    specs.find(s => s.name.toLowerCase().startsWith(n)) ||
    specs.find(s => s.name.toLowerCase().includes(n)) ||
    null
  );
}

// Class a node type into a coarse family so a faithful rebuild that swaps an
// INSTANCE for a FRAME (or COMPONENT) isn't punished, while TEXT↔FRAME is.
function typeClass(t) {
  if (t === 'TEXT') return 'text';
  if (['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'].includes(t)) return 'shape';
  return 'container';   // FRAME / COMPONENT / INSTANCE / GROUP / COMPONENT_SET
}

const normName = s => String(s).replace(/\s+/g, '').toLowerCase().split(',').sort().join(',');
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// Deep-compare a built node tree against a spec node tree, pushing one rule per
// enforced instruction. Only properties the md actually carries are enforced.
function compareNode(specN, builtN, path, rules, tol) {
  const at = path || specN.name;

  // type family
  rules.push({
    ok: typeClass(specN.type) === typeClass(builtN.type),
    msg: typeClass(specN.type) === typeClass(builtN.type)
      ? `type[${at}]: ${typeClass(builtN.type)}`
      : `type[${at}]: spec wants ${specN.type} (${typeClass(specN.type)}), built ${builtN.type} (${typeClass(builtN.type)})`,
  });

  // height (enforced) — width is content-hug, informational only
  if (specN.h != null) {
    const dh = Math.abs((builtN.h ?? 0) - specN.h);
    rules.push({
      ok: dh <= tol,
      msg: dh <= tol ? `height[${at}]: ${builtN.h}px` : `height[${at}]: built ${builtN.h}px, spec ${specN.h}px (off ${dh}px)`,
    });
  }

  // layout direction
  if (specN.lm) {
    rules.push({
      ok: builtN.lm === specN.lm,
      msg: builtN.lm === specN.lm ? `layout[${at}]: ${specN.lm}` : `layout[${at}]: spec ${specN.lm}, built ${builtN.lm || 'NONE'}`,
    });
  }

  // gap
  if (specN.gap != null) {
    rules.push({
      ok: (builtN.gap ?? 0) === specN.gap,
      msg: (builtN.gap ?? 0) === specN.gap ? `gap[${at}]: ${specN.gap}px` : `gap[${at}]: spec ${specN.gap}px, built ${builtN.gap ?? 0}px`,
    });
  }

  // padding (T/R/B/L)
  if (specN.pad) {
    const ok = sameArr(specN.pad, builtN.pad);
    rules.push({
      ok,
      msg: ok ? `padding[${at}]: ${specN.pad.join('/')}` : `padding[${at}]: spec ${specN.pad.join('/')}, built ${(builtN.pad || []).join('/') || 'none'}`,
    });
  }

  // children: enforce count, then recurse by index
  const specKids = specN.children || [];
  if (specKids.length) {
    const builtKids = builtN.children || [];
    const ok = builtKids.length === specKids.length;
    rules.push({
      ok,
      msg: ok ? `children[${at}]: ${specKids.length}` : `children[${at}]: spec ${specKids.length}, built ${builtKids.length}`,
    });
    const n = Math.min(specKids.length, builtKids.length);
    for (let i = 0; i < n; i++) compareNode(specKids[i], builtKids[i], `${at} › ${specKids[i].name}`, rules, tol);
  }
}

/**
 * Enforce a spec against a measured built node.
 * measured = { type, variantProps:[...], variants:[{name,w,h}], sampleTree:<deep tree> }
 * Returns { pass, rules:[{ok,msg}] }.
 */
export function checkConformance(spec, measured, opts = {}) {
  const tol = opts.tolerance ?? 2;
  const rules = [];
  const axisNames = Object.keys(spec.axes || {});
  const isMultiVariant = spec.variants > 1 && axisNames.length >= 1;

  // R1 — a multi-variant component must be a COMPONENT_SET.
  if (isMultiVariant) {
    const ok = measured.type === 'COMPONENT_SET';
    rules.push({ ok, msg: ok
      ? `structure: COMPONENT_SET (spec has ${spec.variants} variants)`
      : `structure: expected COMPONENT_SET (${spec.variants} variants across ${axisNames.join(', ')}), got ${measured.type}` });
  }

  // R2 — variant property names must cover the spec axes.
  if (isMultiVariant && measured.type === 'COMPONENT_SET') {
    const built = (measured.variantProps || []).map(s => s.toLowerCase());
    const missing = axisNames.filter(a => !built.includes(a.toLowerCase()));
    rules.push({ ok: missing.length === 0, msg: missing.length === 0
      ? `axes: ${axisNames.join(', ')} (match spec)`
      : `axes: missing ${missing.join(', ')} — built has ${(measured.variantProps || []).join(', ') || 'none'}` });
  }

  // R3 — deep structural conformance of the sample variant (the md's full
  // instruction set: layout, gap, padding, child tree, sizes).
  if (spec.sample && measured.sampleTree) {
    compareNode(spec.sample, measured.sampleTree, spec.sample.name, rules, tol);
  }

  return { pass: rules.every(r => r.ok), rules };
}
