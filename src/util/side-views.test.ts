import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SIDE_VIEWS, activateView, parseSideView } from './side-views.ts';

describe('side views (ADR 0022)', () => {
  test('the views, in activity bar order', () => {
    assert.deepEqual(SIDE_VIEWS, [
      'explorer',
      'versions',
      'references',
      'storage',
      'comments',
      'assistant',
    ]);
  });

  test('a remembered view is read back; anything else is the Explorer', () => {
    assert.equal(parseSideView('versions'), 'versions');
    assert.equal(parseSideView(null), 'explorer');
    assert.equal(parseSideView('nonsense'), 'explorer');
  });

  test('clicking a view opens it; clicking the open view closes the side bar', () => {
    const closed = { explorerOpen: false, sideView: 'explorer' as const };
    assert.deepEqual(activateView(closed, 'versions'), {
      explorerOpen: true,
      sideView: 'versions',
    });
    const open = { explorerOpen: true, sideView: 'versions' as const };
    assert.deepEqual(activateView(open, 'storage'), {
      explorerOpen: true,
      sideView: 'storage',
    });
    assert.deepEqual(activateView(open, 'versions'), {
      explorerOpen: false,
      sideView: 'versions',
    });
  });
});
