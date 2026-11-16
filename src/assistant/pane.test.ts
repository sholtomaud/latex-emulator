import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WIDTH,
  MIN_WIDTH,
  clampWidth,
  parsePaneState,
  resizeByKey,
  widthFromPointer,
} from './pane.ts';

describe('assistant pane sizing', () => {
  test('width stays between 280px and the smaller of 720px and 60% of the window', () => {
    assert.equal(clampWidth(100, 1600), MIN_WIDTH);
    assert.equal(clampWidth(400, 1600), 400);
    assert.equal(clampWidth(2000, 1600), 720);
    assert.equal(clampWidth(700, 1000), 600);
    assert.equal(clampWidth(Number.NaN, 1600), DEFAULT_WIDTH);
    // A tiny window still gets the minimum.
    assert.equal(clampWidth(500, 300), MIN_WIDTH);
  });

  test('dragging the left edge: the pane is as wide as from the pointer to the right edge', () => {
    assert.equal(widthFromPointer(1200, 1600), 400);
    assert.equal(widthFromPointer(1590, 1600), MIN_WIDTH);
  });

  test('arrow keys on the handle widen and narrow it; Home and End go to the limits', () => {
    assert.equal(resizeByKey('ArrowLeft', 400, 1600), 416);
    assert.equal(resizeByKey('ArrowRight', 400, 1600), 384);
    assert.equal(resizeByKey('Home', 400, 1600), MIN_WIDTH);
    assert.equal(resizeByKey('End', 400, 1600), 720);
    assert.equal(resizeByKey('a', 400, 1600), null);
  });

  test('the remembered state is read back, with defaults for anything missing', () => {
    assert.deepEqual(parsePaneState('{"pinned":false,"width":500}'), {
      pinned: false,
      width: 500,
    });
    assert.deepEqual(parsePaneState(null), {
      pinned: true,
      width: DEFAULT_WIDTH,
    });
    assert.deepEqual(parsePaneState('{"pinned":"x","width":"y"}'), {
      pinned: true,
      width: DEFAULT_WIDTH,
    });
    assert.deepEqual(parsePaneState('garbage'), {
      pinned: true,
      width: DEFAULT_WIDTH,
    });
  });
});
