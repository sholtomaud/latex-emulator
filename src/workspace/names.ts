/** Naming rules for documents and the files they are saved as. */

const key = (s: string) => s.trim().toLowerCase();

/** `base`, or `base 2`, `base 3`… — the first that no existing name uses. */
export function uniqueName(base: string, existing: string[]): string {
  const name = base.trim() || 'Untitled';
  const taken = new Set(existing.map(key));
  if (!taken.has(key(name))) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.has(key(candidate))) return candidate;
  }
}

/** A safe, lower-case file name for a document: "A Short Example" → "a-short-example.tex". */
export function fileNameFor(name: string, extension = '.tex'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'article'}${extension}`;
}

/** A readable document name from an imported file name. */
export function nameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const name = base
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return name || 'Untitled';
}
