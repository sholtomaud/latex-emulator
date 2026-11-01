/** Zotero search hits as citation-typeahead suggestions. Pure; no DOM. */
import { entryFromCsl } from './lookup.ts';
import type { ZoteroHit } from './zotero.ts';

export interface ZoteroSuggestion {
  /** The key it will get in the library. */
  key: string;
  /** The .bib entry to add when it is chosen. */
  text: string;
  authors: string;
  year: string;
  title: string;
}

/** Keys are unique against `taken` and against each other; unusable hits are skipped. */
export function zoteroSuggestions(
  hits: ZoteroHit[],
  taken: Set<string>
): ZoteroSuggestion[] {
  const used = new Set(taken);
  const out: ZoteroSuggestion[] = [];
  for (const hit of hits) {
    try {
      const { key, text } = entryFromCsl(hit.csl, used);
      used.add(key);
      out.push({
        key,
        text,
        authors: hit.creators,
        year: hit.year,
        title: hit.title,
      });
    } catch {
      // Not a CSL record: nothing to suggest.
    }
  }
  return out;
}
