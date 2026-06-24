import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFileKey,
  fragmentText,
  normalizeCommentsResponse,
  summarizeWebhookEvent,
} from '../src/figma-rest.js';

test('extractFileKey accepts file keys and Figma URLs', () => {
  assert.equal(extractFileKey('WDmSrrJg3NjC7RhTSetTFy'), 'WDmSrrJg3NjC7RhTSetTFy');
  assert.equal(
    extractFileKey('https://www.figma.com/design/WDmSrrJg3NjC7RhTSetTFy/Vision-Sprint?node-id=0-1'),
    'WDmSrrJg3NjC7RhTSetTFy',
  );
  assert.equal(
    extractFileKey('https://www.figma.com/file/abcDEF12345/Legacy-File'),
    'abcDEF12345',
  );
  assert.equal(
    extractFileKey('https://www.figma.com/board/un5ebUWDxKQkM1UWjDHOGo/Flexplorer-User-Interviews'),
    'un5ebUWDxKQkM1UWjDHOGo',
  );
  assert.equal(extractFileKey('not a key'), null);
});

test('normalizeCommentsResponse handles official REST and desktop-session shapes', () => {
  const official = normalizeCommentsResponse({
    comments: [{
      id: '1',
      message: 'Official comment',
      file_key: 'file1',
      user: { handle: 'Louis' },
      client_meta: { x: 10, y: 20 },
    }],
  });
  assert.equal(official[0].message, 'Official comment');
  assert.equal(official[0].file_key, 'file1');
  assert.equal(official[0].user.handle, 'Louis');

  const desktop = normalizeCommentsResponse({
    meta: [{
      id: '2',
      key: 'file2',
      message_meta: [{ t: 'Desktop ' }, { t: 'comment' }],
      user: { handle: 'Donna' },
    }],
  });
  assert.equal(desktop[0].message, 'Desktop comment');
  assert.equal(desktop[0].file_key, 'file2');
  assert.equal(desktop[0].user.handle, 'Donna');
});

test('fragmentText and summarizeWebhookEvent handle FILE_COMMENT payloads', () => {
  assert.equal(fragmentText([{ text: 'TODO ' }, { mention: '123' }, { text: ' update' }]), 'TODO @123 update');

  const summary = summarizeWebhookEvent({
    event_type: 'FILE_COMMENT',
    file_name: 'Vision Sprint',
    comment: [{ text: 'Tester auto generated variations' }],
    triggered_by: { handle: 'Louis' },
  });
  assert.equal(summary, 'FILE_COMMENT on Vision Sprint: Louis commented "Tester auto generated variations"');
});
