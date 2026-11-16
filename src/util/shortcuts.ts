interface KeyLike {
  key: string;
  /** The physical key, when known: ⌥ changes `key` on a Mac (⌥B is "∫"). */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const plainModified = (e: KeyLike, key: string) =>
  (e.metaKey || e.ctrlKey) &&
  !e.altKey &&
  !e.shiftKey &&
  e.key.toLowerCase() === key;

/** Ctrl/⌘+B toggles the document explorer (as VS Code's sidebar). */
export function isToggleExplorerShortcut(e: KeyLike): boolean {
  return plainModified(e, 'b');
}

/**
 * Ctrl+Alt+B (⌘⌥B on a Mac) toggles the assistant, as VS Code's secondary
 * side bar (ADR 0022).
 */
export function isToggleAssistantShortcut(e: KeyLike): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    e.altKey &&
    !e.shiftKey &&
    (e.code === 'KeyB' || e.key.toLowerCase() === 'b')
  );
}
