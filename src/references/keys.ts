/**
 * Citation keys in the author_topic_year form: Zotero / Better BibTeX's
 * legacy format `[auth:lower]_[veryshorttitle:lower]_[year]`, e.g.
 * odum_environmental_1996. Pure; no DOM.
 */
import { formatName } from '../latex/bibtex/names.ts';

/**
 * Words skipped when picking the title word (a subset of Better BibTeX's
 * skipwords: English, German, French, Spanish and Italian articles and
 * prepositions).
 */
const SKIP = new Set(
  (
    'a ab aboard about above across after against al along amid among an and ' +
    'anti around as at before behind below beneath beside besides between ' +
    'beyond but by d da das de del della dem den der des despite die do down ' +
    'du during ein eine einem einen einer eines el en et except for from gli ' +
    'i il in inside into is l la las le les like lo los near nor of off on ' +
    'onto or over past per plus round save since so some sur than the ' +
    'through to toward towards un una une under unlike until up upon versus ' +
    'via von while with within without yet zu zum'
  ).split(' ')
);

/** LaTeX's text-mode letters, as plain ASCII. */
const LETTERS: Record<string, string> = {
  ss: 'ss',
  ae: 'ae',
  AE: 'AE',
  oe: 'oe',
  OE: 'OE',
  o: 'o',
  O: 'O',
  aa: 'a',
  AA: 'A',
  l: 'l',
  L: 'L',
  i: 'i',
  j: 'j',
};

/** Plain ASCII text of a BibTeX value: accents dropped, commands removed. */
export function asciiFold(value: string): string {
  return (
    value
      // Accents: \"o, \"{o}, \'{e}, \c{c}, \v s …
      .replace(/\\[`'^"~=.uvHtcdbrk]\s*\{?\s*([A-Za-z])\}?/g, '$1')
      // Letter commands (\ss, \o …); a command taking an argument (\emph{…})
      // is formatting and disappears; any other (\TeX) keeps its name.
      .replace(
        /\\([A-Za-z]+)\s*(\{)?/g,
        (_, name: string, brace?: string) =>
          LETTERS[name] ?? (brace ? '{' : name)
      )
      .replace(/[{}]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/[æÆ]/g, 'ae')
      .replace(/[œŒ]/g, 'oe')
      .replace(/[øØ]/g, 'o')
      .replace(/[łŁ]/g, 'l')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
  );
}

const lettersOnly = (s: string) =>
  asciiFold(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

interface EntryLike {
  fields: Map<string, string>;
}

function authorPart(e: EntryLike): string {
  const names = e.fields.get('author') || e.fields.get('editor');
  // {ll}: the last name without "von" particles (van der Waals → Waals).
  return names ? lettersOnly(formatName(names, 1, '{ll}')) : '';
}

/** The first `count` significant title words. */
function titleWords(e: EntryLike, count: number): string[] {
  return asciiFold(e.fields.get('title') ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !SKIP.has(w))
    .slice(0, count);
}

function yearPart(e: EntryLike): string {
  const year = e.fields.get('year') || e.fields.get('date') || '';
  return /\d{4}/.exec(year)?.[0] ?? '';
}

/** A key for `entry`, unique against `taken` (compared case-insensitively). */
export function citeKey(
  entry: EntryLike,
  taken: Set<string> = new Set()
): string {
  const base =
    [
      // Without an author or editor, the title supplies both words.
      ...(authorPart(entry)
        ? [authorPart(entry), ...titleWords(entry, 1)]
        : titleWords(entry, 2)),
      yearPart(entry),
    ]
      .filter(Boolean)
      .join('_') || 'ref';
  const used = new Set([...taken].map((k) => k.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 1; ; n++) {
    const key = base + suffix(n);
    if (!used.has(key)) return key;
  }
}

/** 1 → a, 26 → z, 27 → aa … (Better BibTeX's postfix). */
function suffix(n: number): string {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(97 + ((n - 1) % 26)) + s;
  return s;
}
