/** Smallest zoom the preview will use, so the page stays legible. */
export const MIN_PREVIEW_SCALE = 0.25;

/**
 * Zoom factor that makes a page of `pageWidth` px fit a container of
 * `containerWidth` px with `gutter` px on each side. Never enlarges the page.
 * Returns 1 when either width is unknown (e.g. the pane is hidden).
 */
export function fitScale(
  containerWidth: number,
  pageWidth: number,
  gutter: number
): number {
  if (containerWidth <= 0 || pageWidth <= 0) return 1;
  const available = containerWidth - 2 * gutter;
  return Math.min(1, Math.max(MIN_PREVIEW_SCALE, available / pageWidth));
}
