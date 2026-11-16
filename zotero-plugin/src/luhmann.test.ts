import { test } from 'node:test';
import assert from 'node:assert';
import {
  compareIds,
  firstFreeChild,
  isId,
  isUnder,
  nextFreeTopLevel,
  nextSibling,
  parent,
  placeAfter,
} from './luhmann.ts';

test('IDs alternate numbers and letters, starting with a number', () => {
  for (const ok of ['1', '12', '1a', '1a2', '21b3c', '1aa', '7z10b'])
    assert.ok(isId(ok), ok);
  for (const bad of ['', 'a', '1A', '01', '1a0', '1-a', '1 a', '1a2/3', 'x1'])
    assert.ok(!isId(bad), bad);
});

test('ordering is Luhmann’s: numbers numerically, a branch right after its parent', () => {
  const ids = ['2', '1a10', '1b', '1', '1a2', '1a', '10', '1a2a', '1z', '1aa'];
  assert.deepStrictEqual([...ids].sort(compareIds), [
    '1',
    '1a',
    '1a2',
    '1a2a',
    '1a10',
    '1b',
    '1z',
    '1aa',
    '2',
    '10',
  ]);
});

test('next sibling and parent', () => {
  assert.strictEqual(nextSibling('1'), '2');
  assert.strictEqual(nextSibling('1a2'), '1a3');
  assert.strictEqual(nextSibling('1a9'), '1a10');
  assert.strictEqual(nextSibling('1a'), '1b');
  assert.strictEqual(nextSibling('1z'), '1aa');
  assert.strictEqual(nextSibling('1az'), '1ba');
  assert.strictEqual(parent('1a2'), '1a');
  assert.strictEqual(parent('1'), null);
});

test('a new child goes after the last existing one', () => {
  const taken = new Set(['1', '1a', '1b', '1b1', '2']);
  assert.strictEqual(firstFreeChild('1', taken), '1c');
  assert.strictEqual(firstFreeChild('1b', taken), '1b2');
  assert.strictEqual(firstFreeChild('2', taken), '2a');
  assert.strictEqual(firstFreeChild('1a', taken), '1a1');
});

test('after an ID: its next sibling if free, else a branch under it', () => {
  const taken = new Set(['1', '1a', '1a1', '1b', '2']);
  assert.strictEqual(placeAfter('2', taken), '3');
  assert.strictEqual(placeAfter('1a1', taken), '1a2');
  // 1b is taken: continuing 1a becomes a branch of 1a.
  assert.strictEqual(placeAfter('1a', taken), '1a2');
  assert.strictEqual(placeAfter('1', taken), '1c');
});

test('a new top-level ID follows the highest; branches and prefixes', () => {
  assert.strictEqual(nextFreeTopLevel(new Set()), '1');
  assert.strictEqual(nextFreeTopLevel(new Set(['1', '3a', '12b'])), '13');
  assert.ok(isUnder('1a2', '1a'));
  assert.ok(isUnder('1a', '1a'));
  assert.ok(!isUnder('1a', '1a2'));
  assert.ok(!isUnder('11', '1'));
  assert.ok(!isUnder('1aa', '1a'));
  assert.ok(isUnder('1a10b', '1a10'));
  assert.ok(!isUnder('1a1', '1a10'));
});
