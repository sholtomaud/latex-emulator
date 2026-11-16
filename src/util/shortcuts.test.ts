import { test } from 'node:test';
import assert from 'node:assert';
import {
  isToggleAssistantShortcut,
  isToggleExplorerShortcut,
} from './shortcuts.ts';

const key = (
  k: string,
  mods: Partial<
    Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>
  > = {},
  code = `Key${k.toUpperCase()}`
) => ({
  key: k,
  code,
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

test('Ctrl+Alt+B and ⌘⌥B toggle the assistant (VS Code’s secondary side bar)', () => {
  assert.strictEqual(
    isToggleAssistantShortcut(key('b', { ctrlKey: true, altKey: true })),
    true
  );
  // On a Mac, ⌥B types "∫": the physical key is what counts.
  assert.strictEqual(
    isToggleAssistantShortcut(
      key('∫', { metaKey: true, altKey: true }, 'KeyB')
    ),
    true
  );
  // Ctrl+B alone is the explorer's, not the assistant's.
  assert.strictEqual(
    isToggleAssistantShortcut(key('b', { ctrlKey: true })),
    false
  );
  assert.strictEqual(
    isToggleExplorerShortcut(key('b', { ctrlKey: true, altKey: true })),
    false
  );
  assert.strictEqual(
    isToggleAssistantShortcut(key('b', { altKey: true })),
    false
  );
  assert.strictEqual(
    isToggleAssistantShortcut(
      key('b', { ctrlKey: true, altKey: true, shiftKey: true })
    ),
    false
  );
  assert.strictEqual(
    isToggleAssistantShortcut(key('n', { ctrlKey: true, altKey: true })),
    false
  );
});
