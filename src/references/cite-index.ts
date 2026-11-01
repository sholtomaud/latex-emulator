/**
 * What citation typeahead and hovers show: one summary per key in the
 * references library. Pure; no DOM.
 */
import { parseBib } from '../latex/bibtex/bib-parser.ts';
import { formatName, numNames } from '../latex/bibtex/names.ts';

export interface CiteEntry {
  key: string;
  /** The .bib file (without .bib). */
  file: string;
  /** "Odum", "Brown and Ulgiati", "Hall et al." (as author–year styles). */
  authors: string;
  year: string;
  /** The title as plain text: braces and markup removed. */
  title: string;
}

/** BibTeX text → readable text: accents applied, braces and commands dropped. */
function plain(value: string): string {
  return (
    value
      .replace(
        /\\([`'^"~=.])\s*\{?\\?([A-Za-z])\}?/g,
        (_, accent: string, ch: string) =>
          (
            ch +
            ({ '`': '̀', "'": '́', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇' }[
              accent
            ] ?? '')
          ).normalize('NFC')
      )
      // \\& → &; \\emph{x} → x; \\LaTeX → LaTeX (a command with no argument).
      .replace(/\\([&%$#_])/g, '$1')
      .replace(/\\([A-Za-z]+)\s*(\{)?/g, (_, name: string, brace?: string) =>
        brace ? '{' : name
      )
      .replace(/[{}]/g, '')
      .replace(/~/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function shortAuthors(list: string): string {
  const n = numNames(list);
  const last = (i: number) => plain(formatName(list, i, '{vv~}{ll}'));
  if (n === 1) return last(1);
  if (n === 2) return `${last(1)} and ${last(2)}`;
  return `${last(1)} et al.`;
}

/** Every entry of every library file (the first of duplicate keys wins). */
export function indexLibrary(sources: Record<string, string>): CiteEntry[] {
  const seen = new Set<string>();
  const out: CiteEntry[] = [];
  for (const [file, source] of Object.entries(sources))
    for (const e of parseBib(source).entries) {
      if (seen.has(e.key.toLowerCase())) continue;
      seen.add(e.key.toLowerCase());
      const names = e.fields.get('author') || e.fields.get('editor') || '';
      out.push({
        key: e.key,
        file,
        authors: names ? shortAuthors(names) : '',
        year:
          /\d{4}/.exec(
            e.fields.get('year') || e.fields.get('date') || ''
          )?.[0] ?? '',
        title: plain(e.fields.get('title') ?? ''),
      });
    }
  return out;
}

/**
 * Entries matching what was typed: keys starting with it first, then keys,
 * authors or titles containing it (case-insensitive), each group by key.
 */
export function matchEntries(
  entries: CiteEntry[],
  typed: string,
  limit = 50
): CiteEntry[] {
  const q = typed.toLowerCase();
  const score = (e: CiteEntry) => {
    const key = e.key.toLowerCase();
    if (key.startsWith(q)) return 0;
    if (key.includes(q)) return 1;
    if (`${e.authors} ${e.title} ${e.year}`.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return entries
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.e.key.localeCompare(b.e.key))
    .slice(0, limit)
    .map((x) => x.e);
}
