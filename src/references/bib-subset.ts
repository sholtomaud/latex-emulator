import { parseBib } from '../latex/bibtex/bib-parser.ts';
import type { BibEntry } from '../latex/bibtex/bib-parser.ts';

/**
 * A document's own .bib files (ADR 0020). The library in the browser holds
 * every entry once; a document's project folder gets, for each file its
 * \bibliography lists, only the entries it cites. Pure.
 */

/**
 * `library` without the entries `cited` doesn't need. Entries are copied
 * exactly as written, and everything else in the file (@string, @preamble,
 * comments) is kept, so bibtex reads the same values. Keys match without
 * case, as in BibTeX; a crossref parent comes with its child; "*" (from
 * \nocite{*}) keeps the whole file.
 */
export function subsetBib(library: string, cited: readonly string[]): string {
  if (cited.includes('*')) return library;
  const { entries } = parseBib(library);
  const byKey = new Map(entries.map((e) => [e.key.toLowerCase(), e]));
  const keep = new Set<BibEntry>();
  const add = (key: string) => {
    const e = byKey.get(key.toLowerCase());
    if (!e || keep.has(e)) return;
    keep.add(e);
    const parent = e.fields.get('crossref');
    if (parent) add(parent);
  };
  for (const k of cited) add(k);

  let out = '';
  let at = 0;
  for (const e of entries) {
    if (keep.has(e)) continue;
    out += library.slice(at, e.span.start);
    at = e.span.end;
  }
  out += library.slice(at);
  // Removing entries leaves their blank lines behind.
  return out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, (end) => (end && out.trim() ? '\n' : ''));
}

export interface BibMerge {
  /** The library file with the new entries (and the @string they use) added. */
  text: string;
  /** Keys added from the other file. */
  added: string[];
  /** Keys in both files with different contents: the library's copy is kept. */
  differing: string[];
}

const sameEntry = (a: BibEntry, b: BibEntry) =>
  a.type === b.type &&
  a.fields.size === b.fields.size &&
  [...a.fields].every(([k, v]) => b.fields.get(k) === v);

const MACRO_USE =
  /(?:^|[\s#])([^\s"#%'(),={}0-9][^\s"#%'(),={}]*)(?=\s*(?:#|$))/g;

/**
 * Bring entries from a project folder's .bib into the library file: those
 * it lacks are appended (with any @string macros they use that the library
 * doesn't define); for a key in both, the library's copy wins and the key
 * is reported if the contents differ, so nothing in the library is ever
 * overwritten.
 */
export function mergeBib(library: string, incoming: string): BibMerge {
  const mine = parseBib(library);
  const theirs = parseBib(incoming);
  const known = new Map(mine.entries.map((e) => [e.key.toLowerCase(), e]));
  const added: BibEntry[] = [];
  const differing: string[] = [];
  for (const e of theirs.entries) {
    const have = known.get(e.key.toLowerCase());
    if (!have) added.push(e);
    else if (!sameEntry(have, e)) differing.push(e.key);
  }
  if (!added.length) return { text: library, added: [], differing };

  const macros: string[] = [];
  for (const e of added)
    for (const raw of e.raw.values())
      for (const m of raw.matchAll(MACRO_USE)) {
        const name = m[1].toLowerCase();
        const value = theirs.macros.get(name);
        if (
          value !== undefined &&
          !mine.macros.has(name) &&
          !macros.includes(name)
        )
          macros.push(name);
      }
  const blocks = [
    ...macros.map((n) => `@string{${n} = {${theirs.macros.get(n)}}}`),
    ...added.map((e) => incoming.slice(e.span.start, e.span.end)),
  ];
  const text = `${library.replace(/\s*$/, '')}\n\n${blocks.join('\n\n')}\n`;
  return { text, added: added.map((e) => e.key), differing };
}
