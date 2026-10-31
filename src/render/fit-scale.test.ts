import { describe, test } from 'node:test';
import assert from 'node:assert';
import { fitScale } from './fit-scale.ts';

describe('fitScale', () => {
  test('is 1 when the page fits with its gutter', () => {
    assert.strictEqual(fitScale(1000, 794, 24), 1);
  });

  test('shrinks the page to fit the container minus gutters', () => {
    // 700px pane, 24px gutter each side → 652px available for a 794px page.
    assert.strictEqual(fitScale(700, 794, 24), 652 / 794);
  });

  test('never scales up past 1', () => {
    assert.strictEqual(fitScale(5000, 794, 24), 1);
  });

  test('clamps to a minimum readable scale', () => {
    assert.strictEqual(fitScale(50, 794, 24), 0.25);
  });

  test('returns 1 for degenerate input (hidden or unmeasured pane)', () => {
    assert.strictEqual(fitScale(0, 794, 24), 1);
    assert.strictEqual(fitScale(700, 0, 24), 1);
  });
});
