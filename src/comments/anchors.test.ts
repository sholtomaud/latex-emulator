import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { reanchor, shiftAnchor } from './anchors.ts';

const a = { start: 10, end: 20 };

describe('shiftAnchor: a comment’s range follows each edit', () => {
  test('an edit before the range moves it; one after leaves it', () => {
    assert.deepEqual(shiftAnchor(a, { offset: 2, removed: 3, inserted: 5 }), {
      start: 12,
      end: 22,
    });
    assert.deepEqual(
      shiftAnchor(a, { offset: 25, removed: 4, inserted: 0 }),
      a
    );
  });

  test('typing right at either edge stays outside the range', () => {
    assert.deepEqual(shiftAnchor(a, { offset: 10, removed: 0, inserted: 3 }), {
      start: 13,
      end: 23,
    });
    assert.deepEqual(
      shiftAnchor(a, { offset: 20, removed: 0, inserted: 3 }),
      a
    );
  });

  test('an edit inside the range grows or shrinks it', () => {
    assert.deepEqual(shiftAnchor(a, { offset: 12, removed: 2, inserted: 6 }), {
      start: 10,
      end: 24,
    });
    assert.deepEqual(shiftAnchor(a, { offset: 12, removed: 8, inserted: 0 }), {
      start: 10,
      end: 12,
    });
  });

  test('an edit over one edge cuts the range at the edit', () => {
    // Deletes 5..15, puts "XY" there: the range keeps 15..20, now 7..12.
    assert.deepEqual(shiftAnchor(a, { offset: 5, removed: 10, inserted: 2 }), {
      start: 7,
      end: 12,
    });
    // Deletes 15..25: the range keeps 10..15.
    assert.deepEqual(shiftAnchor(a, { offset: 15, removed: 10, inserted: 1 }), {
      start: 10,
      end: 15,
    });
  });

  test('deleting all of it collapses the range (its text is gone)', () => {
    assert.deepEqual(shiftAnchor(a, { offset: 8, removed: 15, inserted: 2 }), {
      start: 8,
      end: 8,
    });
  });
});

describe('reanchor: finding a comment’s text after an outside change', () => {
  const text = 'One claim. Two claim. Three claim.';
  test('still there: unchanged', () => {
    assert.deepEqual(reanchor(text, { start: 4, end: 9, quote: 'claim' }), {
      start: 4,
      end: 9,
    });
  });

  test('moved: the occurrence nearest its old place', () => {
    assert.deepEqual(
      reanchor(`>> ${text}`, { start: 15, end: 20, quote: 'claim' }),
      {
        start: 18,
        end: 23,
      }
    );
  });

  test('gone, or nothing to look for: null', () => {
    assert.equal(reanchor(text, { start: 0, end: 4, quote: 'absent' }), null);
    assert.equal(reanchor(text, { start: 3, end: 3, quote: '' }), null);
  });
});
