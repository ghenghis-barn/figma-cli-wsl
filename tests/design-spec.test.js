import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseComponentSpecs, findComponentSpec, checkConformance } from '../src/lib/design-spec.js';

const MD = `# DESIGN.md -- Demo

## 6. Components

### Button

Page: Buttons · 12 variants

| Property | Values |
|---|---|
| Variant | Primary, Secondary, Danger, Invisible |
| Size | Small, Medium, Large |

Sample variant structure:

- **Variant=Primary, Size=Medium** · \`COMPONENT\` · 71×32 · horizontal row, gap 8px, padding 6/12/6/12px · 1 children
  - **Text** · \`TEXT\` · 45×17 · "Button"

### Avatar

Page: Avatars · 16 variants

| Property | Values |
|---|---|
| size | 16px, 24px, 32px |

Sample variant structure:

- **size=32px** · \`COMPONENT\` · 32×32 · 1 children
`;

describe('parseComponentSpecs (tree)', () => {
  it('parses axes and a full sample tree', () => {
    const specs = parseComponentSpecs(MD);
    assert.strictEqual(specs.length, 2);
    const btn = specs.find(s => s.name === 'Button');
    assert.strictEqual(btn.variants, 12);
    assert.deepStrictEqual(btn.axes.Size, ['Small', 'Medium', 'Large']);
    assert.strictEqual(btn.sample.name, 'Variant=Primary, Size=Medium');
    assert.strictEqual(btn.sample.lm, 'HORIZONTAL');
    assert.strictEqual(btn.sample.gap, 8);
    assert.deepStrictEqual(btn.sample.pad, [6, 12, 6, 12]);
    assert.strictEqual(btn.sample.children.length, 1);
    assert.strictEqual(btn.sample.children[0].type, 'TEXT');
    assert.strictEqual(btn.sample.children[0].h, 17);
  });

  it('ignores blocks without a variant count', () => {
    const specs = parseComponentSpecs('## 6. Components\n\n### Nope\n\njust prose\n');
    assert.strictEqual(specs.length, 0);
  });
});

describe('findComponentSpec', () => {
  it('matches case-insensitively and by substring', () => {
    assert.strictEqual(findComponentSpec(MD, 'button').name, 'Button');
    assert.strictEqual(findComponentSpec(MD, 'avat').name, 'Avatar');
    assert.strictEqual(findComponentSpec(MD, 'nope'), null);
  });
});

describe('checkConformance (hard, deep)', () => {
  const spec = findComponentSpec(MD, 'Button');
  const goodTree = {
    name: 'Variant=Primary, Size=Medium', type: 'COMPONENT', w: 71, h: 32,
    lm: 'HORIZONTAL', gap: 8, pad: [6, 12, 6, 12],
    children: [{ name: 'Label', type: 'TEXT', w: 45, h: 17 }],
  };
  const setOf = (tree) => ({ type: 'COMPONENT_SET', variantProps: ['Variant', 'Size'],
    variants: [{ name: tree.name, w: tree.w, h: tree.h }], sampleTree: tree });

  it('PASS when structure, axes, layout, gap, padding and children all match', () => {
    const { pass, rules } = checkConformance(spec, setOf(goodTree));
    assert.ok(pass, JSON.stringify(rules.filter(r => !r.ok)));
  });

  it('FAILS on wrong padding (a real md instruction)', () => {
    const { pass, rules } = checkConformance(spec, setOf({ ...goodTree, pad: [8, 8, 8, 8] }));
    assert.ok(!pass && rules.some(r => !r.ok && /padding/.test(r.msg)));
  });

  it('FAILS on wrong layout direction', () => {
    const { pass, rules } = checkConformance(spec, setOf({ ...goodTree, lm: 'VERTICAL' }));
    assert.ok(!pass && rules.some(r => !r.ok && /layout/.test(r.msg)));
  });

  it('FAILS on wrong gap', () => {
    const { pass, rules } = checkConformance(spec, setOf({ ...goodTree, gap: 4 }));
    assert.ok(!pass && rules.some(r => !r.ok && /gap/.test(r.msg)));
  });

  it('FAILS on wrong child count', () => {
    const { pass, rules } = checkConformance(spec, setOf({ ...goodTree, children: [] }));
    assert.ok(!pass && rules.some(r => !r.ok && /children/.test(r.msg)));
  });

  it('FAILS when a multi-variant component is built as a single node', () => {
    const measured = { type: 'COMPONENT', variants: [{ name: 'Button', w: 71, h: 32 }], sampleTree: goodTree };
    const { pass, rules } = checkConformance(spec, measured);
    assert.ok(!pass && rules.some(r => !r.ok && /COMPONENT_SET/.test(r.msg)));
  });

  it('does not fail on width differences (content-hug)', () => {
    const wide = { ...goodTree, w: 120, children: [{ name: 'Label', type: 'TEXT', w: 90, h: 17 }] };
    const { pass } = checkConformance(spec, setOf(wide));
    assert.ok(pass, 'width drift alone must not fail');
  });

  it('treats INSTANCE/FRAME as the same container class (no false fail)', () => {
    const { pass } = checkConformance(spec, setOf({ ...goodTree, type: 'FRAME' }));
    assert.ok(pass);
  });
});
