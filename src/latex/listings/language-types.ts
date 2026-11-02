/** A string or comment delimiter, as listings declares it. */
export interface Delimited {
  /** l: to end of line; s: open…close; n: nested; b/d/bd/m: string escapes. */
  kind: string;
  open: string;
  close: string;
}

/** What the listings lexer needs of a language (lstlang*.sty). */
export interface LstLanguage {
  sensitive: boolean;
  /** keywords=[1], [2], … */
  keywords: string[][];
  /** TeX control sequences (texcs), without the backslash. */
  texcs: string[][];
  directives: string[];
  /** Character that starts a directive (C's #). */
  directiveChar?: string;
  comments: Delimited[];
  strings: Delimited[];
}

/** listings.cfg's defaultdialect for the languages we ship. */
export const DEFAULT_DIALECTS: Record<string, string> = {
  c: 'ansi',
  'c++': 'iso',
  tex: 'plain',
  fortran: '95',
};
