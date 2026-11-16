/**
 * The assistant pane's size and pinning (ADR 0022, 0023). Pinned, it is a
 * column of the layout; unpinned, it lies over the preview. Its left edge
 * can be dragged or moved with the arrow keys. Pure.
 */

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 720;
export const DEFAULT_WIDTH = 352; // 22rem
const STEP = 16;

/** Between the minimum and the smaller of 720px and 60% of the window. */
export function clampWidth(width: number, viewport: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewport * 0.6));
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));
}

/** The pane ends at the window's right edge, so it starts at the pointer. */
export function widthFromPointer(pointerX: number, viewport: number): number {
  return clampWidth(viewport - pointerX, viewport);
}

/** The handle's keys: ← widens (the edge moves left), → narrows. */
export function resizeByKey(
  key: string,
  width: number,
  viewport: number
): number | null {
  const next: Record<string, number> = {
    ArrowLeft: width + STEP,
    ArrowRight: width - STEP,
    Home: MIN_WIDTH,
    End: MAX_WIDTH,
  };
  return key in next ? clampWidth(next[key], viewport) : null;
}

export interface PaneState {
  pinned: boolean;
  width: number;
}

/** The remembered `assistant-pane` preference. */
export function parsePaneState(text: string | null): PaneState {
  let json: unknown = null;
  try {
    json = JSON.parse(text ?? 'null');
  } catch {
    // Use the defaults.
  }
  const o = (typeof json === 'object' && json ? json : {}) as Record<
    string,
    unknown
  >;
  return {
    pinned: typeof o.pinned === 'boolean' ? o.pinned : true,
    width: typeof o.width === 'number' ? o.width : DEFAULT_WIDTH,
  };
}
