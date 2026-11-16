/**
 * The service worker's precache list (ADR 0021): every file of a build,
 * written into the hand-written public/sw.js after `vite build` so the
 * worker's bytes change with every release (that is how browsers notice an
 * update). Pure: scripts/precache.ts does the file I/O.
 */

export interface PrecacheManifest {
  /** Short hash of every file's name and bytes: names the cache. */
  version: string;
  /** Paths relative to the worker, './' standing for the app's start page. */
  files: string[];
}

/** Where public/sw.js expects the manifest. */
export const PRECACHE_MARKER = '/* __PRECACHE__ */ null';

/** The worker itself, and GitHub Pages' extras, aren't cached. */
const SKIP = new Set(['sw.js', '404.html', '.nojekyll']);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

export async function precacheManifest(
  build: { path: string; bytes: Uint8Array }[]
): Promise<PrecacheManifest> {
  const kept = build
    .filter((f) => !SKIP.has(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const parts: string[] = [];
  for (const f of kept) parts.push(`${f.path}\0${await sha256(f.bytes)}`);
  const version = (
    await sha256(new TextEncoder().encode(parts.join('\n')))
  ).slice(0, 16);
  return { version, files: ['./', ...kept.map((f) => f.path)] };
}

export function injectPrecache(sw: string, manifest: PrecacheManifest): string {
  if (!sw.includes(PRECACHE_MARKER))
    throw new Error(`sw.js has no ${PRECACHE_MARKER} marker to replace`);
  return sw.replace(PRECACHE_MARKER, JSON.stringify(manifest));
}
