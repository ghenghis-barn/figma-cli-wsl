import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { getCdpUrl, isWsl, rewriteCdpWebSocketUrl } from '../src/platform.js';

const originalFigmaCdpPort = process.env.FIGMA_CDP_PORT;

afterEach(() => {
  if (originalFigmaCdpPort === undefined) {
    delete process.env.FIGMA_CDP_PORT;
  } else {
    process.env.FIGMA_CDP_PORT = originalFigmaCdpPort;
  }
});

describe('CDP local bridge port', () => {
  it('keeps the WSL local bridge port separate from the Figma-side CDP port', () => {
    delete process.env.FIGMA_CDP_PORT;

    const expectedPort = isWsl() ? 39222 : 9222;
    assert.strictEqual(getCdpUrl(9222), `http://127.0.0.1:${expectedPort}`);
  });

  it('honors an explicit FIGMA_CDP_PORT override', () => {
    process.env.FIGMA_CDP_PORT = '45555';

    assert.strictEqual(getCdpUrl(9222), 'http://127.0.0.1:45555');
    assert.strictEqual(
      rewriteCdpWebSocketUrl('ws://127.0.0.1:9222/devtools/page/1', 9222),
      'ws://127.0.0.1:45555/devtools/page/1'
    );
  });
});
