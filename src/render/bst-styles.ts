/**
 * The bibliography styles the app ships: unmodified .bst files from TeX Live
 * (src/assets/bst/README.md). Loaded lazily as their own chunk, so the
 * initial bundle stays small; they are precached for offline use.
 */
const modules = import.meta.glob<string>('../assets/bst/*.bst', {
  query: '?raw',
  import: 'default',
});

let loading: Promise<Record<string, string>> | null = null;

export function loadBstStyles(): Promise<Record<string, string>> {
  loading ??= Promise.all(
    Object.entries(modules).map(
      async ([path, load]) =>
        [path.replace(/^.*\/|\.bst$/g, ''), await load()] as const
    )
  ).then(Object.fromEntries);
  return loading;
}
