/**
 * What the editor needs from the app to complete and explain citation keys.
 * The workspace provides it; Monaco glue (monaco.ts) consumes it.
 */
import type { CiteEntry } from '../references/cite-index.ts';
import type { ZoteroSuggestion } from '../references/zotero-suggest.ts';

export interface CitationServices {
  /** Every entry in the references library. */
  entries(): CiteEntry[];
  /** Zotero matches for what was typed ([] when Zotero typeahead is off). */
  zotero(typed: string): Promise<ZoteroSuggestion[]>;
  /** A Zotero suggestion was chosen: add its entry to the library. */
  add(suggestion: ZoteroSuggestion): Promise<void>;
}
