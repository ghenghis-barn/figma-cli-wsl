import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseW3cTokens } from '../src/code-import/w3c-tokens.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'code-import');
const fixture = (name) => readFileSync(join(FIX, name), 'utf8');

test('w3c: extracts colors with $value and legacy value, drops group prefix', () => {
  const { tokens } = parseW3cTokens(fixture('tokens-style-dictionary.json'));
  assert.equal(tokens.color['brand-primary'], '#0969da');
  assert.equal(tokens.color['brand-secondary'], '#6639ba');
});

test('w3c: resolves {alias} references', () => {
  const { tokens } = parseW3cTokens(fixture('tokens-style-dictionary.json'));
  assert.equal(tokens.color['text-default'], '#0969da');
});

test('w3c: dimensions become numbers (px direct, rem ×16)', () => {
  const { tokens } = parseW3cTokens(fixture('tokens-style-dictionary.json'));
  assert.equal(tokens.radius['radius-md'], 6);
  assert.equal(tokens.radius['radius-lg'], 12);
  assert.equal(tokens.spacing['spacing-sm'], 8);
});

test('w3c: typography tokens keep the full shape', () => {
  const { tokens } = parseW3cTokens(fixture('tokens-style-dictionary.json'));
  assert.deepEqual(tokens.typography['font-body'], { fontFamily: 'Inter', fontSize: 14, fontWeight: 400, lineHeight: 20 });
  assert.ok(tokens.fonts.includes('Inter'));
});

test('w3c: cyclic aliases throw a clear error', () => {
  const cyclic = JSON.stringify({ a: { $value: '{b}' }, b: { $value: '{a}' } });
  assert.throws(() => parseW3cTokens(cyclic), /cycl|circular/i);
});

test('w3c: invalid JSON throws with context', () => {
  assert.throws(() => parseW3cTokens('not json'), /JSON/);
});

import { parseCss } from '../src/code-import/css.js';

test('css: shadcn bare HSL triples become hex colors', () => {
  const { tokens } = parseCss(fixture('shadcn-globals.css'));
  assert.equal(tokens.color['background'], '#ffffff');
  assert.match(tokens.color['primary'], /^#[0-9a-f]{6}$/);
});

test('css: hex passthrough and var() reference resolution', () => {
  const { tokens } = parseCss(fixture('shadcn-globals.css'));
  assert.equal(tokens.color['brand'], '#0969da');
  assert.equal(tokens.color['ref'], '#0969da');
});

test('css: radius-named rem values become px radius tokens', () => {
  const { tokens } = parseCss(fixture('shadcn-globals.css'));
  assert.equal(tokens.radius['radius'], 8);
});

test('css: .dark block values are skipped in v1 (first definition wins)', () => {
  const { tokens } = parseCss(fixture('shadcn-globals.css'));
  assert.equal(tokens.color['background'], '#ffffff'); // not the .dark value
});

test('css: tailwind v4 @theme — color-/radius-/spacing-/font- prefixes', () => {
  const { tokens } = parseCss(fixture('tailwind-v4-theme.css'));
  assert.match(tokens.color['primary'], /^#[0-9a-f]{6}$/);   // oklch converted
  assert.equal(tokens.color['surface'], '#f6f8fa');           // rgb() converted
  assert.equal(tokens.radius['radius-md'], 6);
  assert.equal(tokens.spacing['spacing-gutter'], 24);
  assert.deepEqual(tokens.fonts, ['Inter']);
});
