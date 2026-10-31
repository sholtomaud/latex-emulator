/**
 * Served URLs of the Latin Modern WOFF2 files (GUST Font License, see
 * src/assets/fonts/GUST-FONT-LICENSE.TXT). Vite fingerprints them and applies
 * the deploy base path, so they work on GitHub Pages too.
 */
const files = import.meta.glob('../assets/fonts/*.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const FONT_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [
    path.replace(/^.*\/(.*)\.woff2$/, '$1'),
    url,
  ])
);
