interface KeyLike {
  key: string;
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
