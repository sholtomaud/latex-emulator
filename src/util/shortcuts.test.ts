import { test } from 'node:test';
import assert from 'node:assert';
import { isToggleExplorerShortcut } from './shortcuts.ts';

const key = (
  k: string,
  mods: Partial<
    Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>
  > = {}
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('Ctrl+B and ⌘B toggle the explorer; other combinations do not', () => {
  assert.strictEqual(
    isToggleExplorerShortcut(key('b', { ctrlKey: true })),
    true
  );
  assert.strictEqual(
    isToggleExplorerShortcut(key('B', { metaKey: true })),
    true
  );
  assert.strictEqual(isToggleExplorerShortcut(key('b')), false);
  assert.strictEqual(
    isToggleExplorerShortcut(key('b', { ctrlKey: true, shiftKey: true })),
    false
  );
  assert.strictEqual(
    isToggleExplorerShortcut(key('p', { ctrlKey: true })),
    false
  );
});
