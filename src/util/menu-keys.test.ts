import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuFocusIndex } from './menu-keys.ts';

test('menu keys move focus like an ARIA menu: wrap, Home, End', () => {
  assert.equal(menuFocusIndex(0, 4, 'ArrowDown'), 1);
  assert.equal(menuFocusIndex(3, 4, 'ArrowDown'), 0);
  assert.equal(menuFocusIndex(0, 4, 'ArrowUp'), 3);
  assert.equal(menuFocusIndex(2, 4, 'Home'), 0);
  assert.equal(menuFocusIndex(1, 4, 'End'), 3);
  // Nothing focused yet: Down starts at the top, Up at the bottom.
  assert.equal(menuFocusIndex(-1, 4, 'ArrowDown'), 0);
  assert.equal(menuFocusIndex(-1, 4, 'ArrowUp'), 3);
  assert.equal(menuFocusIndex(1, 4, 'a'), null);
});
