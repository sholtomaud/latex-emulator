/**
 * Which menu item a key moves focus to (WAI-ARIA menu pattern): arrows
 * wrap, Home and End jump. `current` is -1 when no item has focus. Null
 * for keys that don't move focus. Pure.
 */
export function menuFocusIndex(
  current: number,
  count: number,
  key: string
): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
  if (key === 'ArrowUp')
    return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}
