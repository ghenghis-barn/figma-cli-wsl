import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkerCode, listPagesCode } from '../src/design-extract.js';

test('walkerCode produces syntactically valid JS', () => {
  const code = walkerCode('123:45');
  // Throws SyntaxError if invalid. Wrap in a function shell because the
  // code is an async IIFE expression.
  assert.doesNotThrow(() => new Function(`return ${code}`));
});

test('walkerCode embeds page id and options', () => {
  const code = walkerCode('123:45', { maxDepth: 5, textLimit: 40 });
  assert.match(code, /"123:45"/);
  assert.match(code, /MAX_DEPTH = 5/);
  assert.match(code, /TEXT_LIMIT = 40/);
});

test('walkerCode defaults: depth 8, text 80', () => {
  const code = walkerCode('1:1');
  assert.match(code, /MAX_DEPTH = 8/);
  assert.match(code, /TEXT_LIMIT = 80/);
});

test('listPagesCode is valid JS', () => {
  assert.doesNotThrow(() => new Function(`return ${listPagesCode()}`));
});

test('walkerCode loads the page before reading children (dynamic-page mode)', () => {
  const code = walkerCode('1:1');
  assert.match(code, /loadAsync/);
  // loadAsync must appear BEFORE the first children access
  assert.ok(code.indexOf('loadAsync') < code.indexOf('count(page)'));
});
