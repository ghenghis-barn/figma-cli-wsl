import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaseBundle,
  buildEvidenceEvalCode,
} from '../src/commands/adversarial-review.js';

test('Figma evidence collection attempts screenshots by default', () => {
  assert.match(buildEvidenceEvalCode({}), /const includeScreenshots = true;/);
  assert.match(buildEvidenceEvalCode({ screenshots: false }), /const includeScreenshots = false;/);
});

test('case bundle keeps screenshot failures as optional visual evidence notes', () => {
  const bundle = buildCaseBundle({
    fileName: 'UX Strategy',
    page: { id: '1:1', name: 'WSL/Windows' },
    slides: [
      {
        id: '2:2',
        name: 'CTO Review',
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        childCount: 12,
        text: [{ text: 'Mac hardware request remains unresolved.' }],
        screenshot: null,
        screenshotError: 'Export failed in Figma Desktop',
      },
    ],
  });

  assert.match(bundle.evidence.summary, /Screenshots are attempted by default/);
  assert.equal(bundle.evidence.slides[0].screenshotError, 'Export failed in Figma Desktop');
  assert.deepEqual(bundle.evidence.visualNotes, [
    'Visual screenshot unavailable for "CTO Review": Export failed in Figma Desktop',
  ]);
});

test('case bundle exposes configurable debate roles', () => {
  const bundle = buildCaseBundle({
    fileName: 'Decision Deck',
    page: { id: '1:1', name: 'Options' },
    slides: [],
  }, {
    question: 'Which operating model should we adopt?',
    answer1Id: 'centralised',
    answer1Label: 'Centralised Platform',
    answer1Position: 'Consolidate ownership in a central platform team.',
    answer2Id: 'federated',
    answer2Label: 'Federated Teams',
    answer2Position: 'Keep ownership distributed across product teams.',
  });

  assert.equal(bundle.answer1.id, 'centralised');
  assert.equal(bundle.answer1.label, 'Centralised Platform');
  assert.equal(bundle.answer2.id, 'federated');
  assert.equal(bundle.answer2.label, 'Federated Teams');
  assert.equal(bundle.question, 'Which operating model should we adopt?');
});
