import type { LstLanguage } from '../latex/listings/language-types.ts';

/**
 * listings' language definitions (src/latex/listings/languages.ts, ~27 KB
 * gzipped) as their own chunk, loaded only for documents that use listings.
 */
let loading: Promise<Record<string, LstLanguage>> | null = null;

export function loadLstLanguages(): Promise<Record<string, LstLanguage>> {
  loading ??= import('../latex/listings/languages.ts').then((m) => m.LANGUAGES);
  return loading;
}

/** Whether a source uses listings (and so needs the language data). */
export function usesListings(source: string): boolean {
  return /\\(?:begin\{lstlisting\}|lstinline|lstset)/.test(source);
}
