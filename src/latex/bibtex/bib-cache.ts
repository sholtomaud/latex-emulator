/**
 * Parsed .bib files, kept while their text is unchanged. The references
 * library can hold tens of thousands of entries. Before this cache, every
 * preview render re-parsed all of it (≈140 ms for 10,000 entries), and
 * every undefined citation scanned it again with a regex (docs/backlog.md).
 * Pure; no DOM.
 *
 * Results are shared: callers must not mutate them.
 */
import { parseBib } from './bib-parser.ts';
import type { ParsedBib } from './bib-parser.ts';

/**
 * Texts are kept while their total length stays within this budget, least
 * recently used evicted first. A parse takes memory roughly in proportion
 * to its text, so this bounds the cache to a few copies of a 10,000-entry
 * library (2.8 MB each) while any number of small files fit.
 */
const BUDGET = 16_000_000;

interface Cached {
  /** Parses of the text, by predefined-macro signature. */
  parsed: Map<string, ParsedBib>;
  index?: BibKeyIndex;
}

/** text → its parses and key index, least recently used first. */
const cache = new Map<string, Cached>();
let cachedLength = 0;
let parses = 0;

/** The cache slot for `text`, now the most recently used. */
function slot(text: string): Cached {
  let value = cache.get(text);
  if (value) {
    cache.delete(text);
    cache.set(text, value);
    return value;
  }
  value = { parsed: new Map() };
  cache.set(text, value);
  cachedLength += text.length;
  // Never evict the text just added, however long it is.
  for (const old of cache.keys()) {
    if (cachedLength <= BUDGET || old === text) break;
    cache.delete(old);
    cachedLength -= old.length;
  }
  return value;
}

const signature = (macros?: Map<string, string>) =>
  macros ? [...macros].map(([k, v]) => `${k}\u0001${v}`).join('\u0002') : '';

/** `parseBib(text, predefined)`, parsed once while `text` stays cached. */
export function parseBibCached(
  text: string,
  predefined?: Map<string, string>
): ParsedBib {
  const { parsed: byMacros } = slot(text);
  const sig = signature(predefined);
  let parsed = byMacros.get(sig);
  if (!parsed) {
    parses++;
    parsed = parseBib(text, predefined);
    byMacros.set(sig, parsed);
  }
  return parsed;
}

export interface BibKeyIndex {
  /** Lower-cased keys of the entries BibTeX can read. */
  readable: Set<string>;
  /**
   * Lower-cased keys as written, `@type{key,` or `@type(key,`, readable or
   * not, mapped to the offset of the first one's `@`. This is what
   * `/@\s*\w+\s*[{(]\s*KEY\s*,/i` used to find, one key at a time.
   */
  written: Map<string, number>;
}

/** Where `@\s*\w+\s*[{(]\s*` matches, a key starts. */
const ENTRY_START = /@\s*\w+\s*[{(]\s*/g;

function scanWritten(text: string): Map<string, number> {
  const written = new Map<string, number>();
  for (const m of text.matchAll(ENTRY_START)) {
    // The key runs to the next comma (a key never contains one), less
    // trailing white space. The scan resumes at the key's start, so a
    // later @ inside it is still found, as the per-key regex would.
    const from = m.index + m[0].length;
    const comma = text.indexOf(',', from);
    if (comma < 0) break;
    const key = text.slice(from, comma).trimEnd().toLowerCase();
    if (key && !written.has(key)) written.set(key, m.index);
  }
  return written;
}

/** The keys of a .bib file, for saying why a citation is undefined. */
export function bibKeyIndex(text: string): BibKeyIndex {
  const cached = slot(text);
  cached.index ??= {
    readable: new Set(
      parseBibCached(text).entries.map((e) => e.key.toLowerCase())
    ),
    written: scanWritten(text),
  };
  return cached.index;
}

/** How many real parses have run (for tests). */
export const bibCacheStats = (): { parses: number } => ({ parses });

/** Forget everything (for tests). */
export function clearBibCache(): void {
  cache.clear();
  cachedLength = 0;
  parses = 0;
}
