import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createPositionMap } from './positions.ts';

describe('createPositionMap', () => {
  const map = createPositionMap('ab\ncd\r\n\nef');

  test('offsets map to 1-based line and column', () => {
    assert.deepStrictEqual(map.toPosition(0), { lineNumber: 1, column: 1 });
    assert.deepStrictEqual(map.toPosition(2), { lineNumber: 1, column: 3 });
    assert.deepStrictEqual(map.toPosition(3), { lineNumber: 2, column: 1 });
    // 'ab\ncd\r\n\nef': lines start at offsets 0, 3, 7 and 8.
    assert.deepStrictEqual(map.toPosition(7), { lineNumber: 3, column: 1 });
    assert.deepStrictEqual(map.toPosition(8), { lineNumber: 4, column: 1 });
    assert.deepStrictEqual(map.toPosition(9), { lineNumber: 4, column: 2 });
  });

  test('offsets are clamped to the text', () => {
    assert.deepStrictEqual(map.toPosition(-5), { lineNumber: 1, column: 1 });
    assert.deepStrictEqual(map.toPosition(999), { lineNumber: 4, column: 3 });
  });

  test('columns count UTF-16 code units, like Monaco', () => {
    const m = createPositionMap('😀x');
    assert.deepStrictEqual(m.toPosition(2), { lineNumber: 1, column: 3 });
  });

  test('positions map back to offsets', () => {
    assert.strictEqual(map.toOffset({ lineNumber: 2, column: 2 }), 4);
    // Lines past the end clamp to the last line.
    assert.strictEqual(map.toOffset({ lineNumber: 9, column: 1 }), 8);
  });

  test('an empty text has one line', () => {
    assert.deepStrictEqual(createPositionMap('').toPosition(0), {
      lineNumber: 1,
      column: 1,
    });
  });
});
