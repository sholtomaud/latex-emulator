/**
 * Zotero suggestions while typing a citation key (ADR 0011): one search per
 * 3+ character prefix, cached, and paused after a failed search.
 *
 * From a website, Zotero on this computer never answers: Chrome's Local
 * Network Access check blocks the request, and Zotero drops requests from
 * browsers (ADR 0009). A rejected web API key fails the same way on every
 * prefix. So the first failure is reported once and no more requests are
 * sent until the settings change (reset). Pure; no DOM.
 */
import { zoteroSuggestions } from './zotero-suggest.ts';
import type { ZoteroSuggestion } from './zotero-suggest.ts';
import type { ZoteroSearch, ZoteroSource } from './zotero.ts';

export interface ZoteroTypeaheadDeps {
  search(source: ZoteroSource, query: string): Promise<ZoteroSearch>;
  /** Keys already in the library, which suggestions must not reuse. */
  keys(): Set<string>;
  /** A search failed and suggestions are now paused: tell the user. */
  onFailure(message: string): void;
}

export function createZoteroTypeahead(deps: ZoteroTypeaheadDeps) {
  let cache = new Map<string, Promise<ZoteroSuggestion[]>>();
  let paused = false;

  return {
    suggest(source: ZoteroSource, typed: string): Promise<ZoteroSuggestion[]> {
      const q = typed.trim();
      if (q.length < 3 || paused) return Promise.resolve([]);
      const key = q.toLowerCase();
      let result = cache.get(key);
      if (!result) {
        const mine = cache;
        result = deps.search(source, q).then((r) => {
          if (r.ok) return zoteroSuggestions(r.hits, deps.keys());
          // Only the first failure since the last reset is reported.
          if (mine === cache && !paused) {
            paused = true;
            deps.onFailure(`Zotero suggestions are paused: ${r.message}`);
          }
          return [];
        });
        cache.set(key, result);
      }
      return result;
    },
    /** Settings or the library changed: forget results and try again. */
    reset() {
      cache = new Map();
      paused = false;
    },
  };
}
