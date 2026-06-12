/**
 * DESIGN.md exporter — the reverse of src/design-md.js.
 *
 * Three units:
 *  1. walkerCode()/listPagesCode(): JS strings evaluated INSIDE Figma
 *     (async IIFEs returning JSON.stringify'd compact node trees).
 *  2. Aggregator: pure functions building color/typography/spacing/radius/
 *     shadow censuses, semantic names, variant matrices from walker JSON.
 *  3. generateDesignMd(): emits the 11-section plugin-compatible markdown
 *     that parseDesignMd() (src/design-md.js) reads back unchanged.
 */

/** Eval snippet: list all pages of the open file. */
export function listPagesCode() {
  return `(async () => {
    await figma.loadAllPagesAsync();
    return JSON.stringify(figma.root.children.map(p => ({ id: p.id, name: p.name, frames: p.children.length })));
  })()`;
}

/**
 * Eval snippet: walk one page and return its compact node tree.
 * Kept self-contained — no outer-scope references — because it runs in the
 * Figma plugin sandbox.
 */
export function walkerCode(pageId, { maxDepth = 8, textLimit = 80 } = {}) {
  return `(async () => {
    const MAX_DEPTH = ${Number(maxDepth)};
    const TEXT_LIMIT = ${Number(textLimit)};
    const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    const paints = (arr) => {
      if (!Array.isArray(arr)) return undefined;
      const out = [];
      for (const p of arr) {
        if (p.visible === false) continue;
        if (p.type === 'SOLID') out.push(hex(p.color) + (p.opacity != null && p.opacity < 1 ? '@' + Math.round(p.opacity * 100) : ''));
        else out.push(p.type);
      }
      return out.length ? out : undefined;
    };
    const walk = (n, depth) => {
      const o = { t: n.type, n: n.name };
      if ('width' in n) { o.w = Math.round(n.width); o.h = Math.round(n.height); }
      if ('layoutMode' in n && n.layoutMode !== 'NONE') {
        o.lm = n.layoutMode;
        if (n.itemSpacing) o.gap = n.itemSpacing;
        const pad = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft];
        if (pad.some(v => v > 0)) o.pad = pad;
      }
      try { const f = paints(n.fills); if (f) o.fills = f; } catch (e) {}
      try { const s = paints(n.strokes); if (s) { o.strokes = s; if (typeof n.strokeWeight === 'number') o.sw = n.strokeWeight; } } catch (e) {}
      if ('cornerRadius' in n) {
        if (typeof n.cornerRadius === 'number') { if (n.cornerRadius > 0) o.r = n.cornerRadius; }
        else o.r = [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius];
      }
      if (Array.isArray(n.effects) && n.effects.length) {
        const fx = n.effects.filter(e => e.visible !== false).map(e =>
          (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
            ? { type: e.type, x: e.offset.x, y: e.offset.y, blur: e.radius, spread: e.spread || 0, color: hex(e.color), a: Math.round((e.color.a == null ? 1 : e.color.a) * 100) / 100 }
            : { type: e.type, blur: e.radius });
        if (fx.length) o.fx = fx;
      }
      if (n.type === 'TEXT') {
        o.txt = { chars: (n.characters || '').slice(0, TEXT_LIMIT) };
        if (n.fontName !== figma.mixed) { o.txt.font = n.fontName.family; o.txt.style = n.fontName.style; }
        if (n.fontSize !== figma.mixed) o.txt.size = n.fontSize;
        if (n.lineHeight !== figma.mixed && n.lineHeight && n.lineHeight.unit !== 'AUTO') o.txt.lh = n.lineHeight.value;
        if (n.letterSpacing !== figma.mixed && n.letterSpacing && n.letterSpacing.value) o.txt.ls = n.letterSpacing.value;
      }
      if (n.type === 'COMPONENT_SET') {
        try { o.vp = n.variantGroupProperties; } catch (e) {}
        o.kidCount = n.children.length;
        if (n.children.length) o.kids = [walk(n.children[0], depth + 1)];
        return o;
      }
      if (n.type === 'INSTANCE') { o.mc = n.name; return o; }
      if ('children' in n && n.children.length) {
        if (depth >= MAX_DEPTH) { o.more = n.children.length; return o; }
        o.kids = n.children.map(c => walk(c, depth + 1));
      }
      return o;
    };
    const page = await figma.getNodeByIdAsync(${JSON.stringify(String(pageId))});
    if (!page) return JSON.stringify({ error: 'page not found' });
    if (typeof page.loadAsync === 'function') await page.loadAsync();
    let visited = 0;
    const count = (n) => { visited++; if ('children' in n) n.children.forEach(count); };
    count(page);
    return JSON.stringify({ id: page.id, name: page.name, nodeCount: visited, frames: page.children.map(c => walk(c, 0)) });
  })()`;
}
