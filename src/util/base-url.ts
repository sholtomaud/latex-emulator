export interface BaseUrlInput {
  /** Vite's `import.meta.env.BASE_URL`: './' for relative builds, or '/repo/'. */
  buildBase: string;
  hostname: string;
  pathname: string;
}

/**
 * The path the app is served from, always with a trailing slash. Used as
 * `window.BOBA_BASE_URL` by the router.
 *
 * - An absolute build base (`vite build --base /latex-emulator/`, used for
 *   GitHub Pages) is authoritative.
 * - Relative builds (`--base ./`) on *.github.io fall back to Boba's heuristic:
 *   the first path segment is the repo name.
 * - Otherwise the app is at the root.
 */
export function resolveBaseUrl({
  buildBase,
  hostname,
  pathname,
}: BaseUrlInput): string {
  if (buildBase.startsWith('/')) {
    return buildBase.endsWith('/') ? buildBase : `${buildBase}/`;
  }
  if (hostname.endsWith('.github.io')) {
    const repo = pathname.split('/')[1];
    if (repo) return `/${repo}/`;
  }
  return '/';
}
