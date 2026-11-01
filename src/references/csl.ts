/**
 * CSL-JSON (what DOI content negotiation returns) → a BibTeX entry.
 * Pure; no DOM.
 */
import type { BibEntryData, BibField } from './serialize.ts';

type Csl = Record<string, unknown>;

const TYPES: Record<string, string> = {
  'article-journal': 'article',
  'journal-article': 'article',
  article: 'article',
  'article-magazine': 'article',
  'article-newspaper': 'article',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  chapter: 'incollection',
  'book-chapter': 'incollection',
  'paper-conference': 'inproceedings',
  'proceedings-article': 'inproceedings',
  report: 'techreport',
  thesis: 'phdthesis',
  dissertation: 'phdthesis',
};

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Crossref titles may carry these (JATS-like) tags. */
const TAGS: Record<string, string> = {
  i: '\\emph',
  em: '\\emph',
  b: '\\textbf',
  strong: '\\textbf',
  sub: '\\textsubscript',
  sup: '\\textsuperscript',
  scp: '\\textsc',
};

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)
        )
      : (ENTITIES[e.toLowerCase()] ?? m)
  );

const escapeSpecials = (s: string) => s.replace(/([&%$#_{}])/g, '\\$1');

/**
 * Escape plain text for BibTeX. With `protect`, brace words with a capital
 * after their first letter (acronyms, H.T., iPhone), so styles that
 * lower-case titles keep them.
 */
function plain(text: string, protect = false): string {
  return decode(text)
    .split(/(\s+)/)
    .map((w) => {
      if (!w || /^\s+$/.test(w)) return w;
      const escaped = escapeSpecials(w);
      return protect && /^.+[A-Z]/u.test(w.replace(/^[^\p{L}]+/u, ''))
        ? `{${escaped}}`
        : escaped;
    })
    .join('');
}

/** Text with Crossref markup as LaTeX. */
function text(value: string, protect = false): string {
  let out = '';
  const stack: string[] = [];
  for (const part of value.split(/(<\/?[a-z][a-z0-9]*[^>]*>)/i)) {
    const tag = /^<(\/?)([a-z][a-z0-9]*)/i.exec(part);
    if (!tag) out += plain(part, protect);
    else {
      const command = TAGS[tag[2].toLowerCase()];
      if (!command) continue; // unknown markup: keep its text only
      if (tag[1]) {
        if (stack.pop() !== undefined) out += '}';
      } else {
        stack.push(command);
        out += `${command}{`;
      }
    }
  }
  return out + '}'.repeat(stack.length);
}

const str = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' || typeof s === 'number'
    ? String(s).trim() || undefined
    : undefined;
};

function names(v: unknown): string | undefined {
  if (!Array.isArray(v) || !v.length) return undefined;
  return v
    .map((n: Csl) => {
      if (typeof n.literal === 'string') return `{${plain(n.literal)}}`;
      const particle = str(n['non-dropping-particle']);
      const family = [particle, str(n.family)].filter(Boolean).join(' ');
      return [family, str(n.suffix), str(n.given)]
        .filter(Boolean)
        .map((p) => escapeSpecials(p!))
        .join(', ');
    })
    .join(' and ');
}

function date(record: Csl): number[] | undefined {
  for (const field of [
    'issued',
    'published-print',
    'published',
    'published-online',
    'created',
  ]) {
    const parts = (
      record[field] as { 'date-parts'?: unknown[][] } | undefined
    )?.['date-parts']?.[0];
    if (Array.isArray(parts) && parts[0] != null) return parts.map(Number);
  }
  return undefined;
}

const isDoiUrl = (url: string) => /^https?:\/\/(dx\.)?doi\.org\//i.test(url);

export function cslToEntry(record: unknown): BibEntryData {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new Error('The response is not a CSL-JSON record.');
  const r = record as Csl;
  const type = TYPES[String(r.type)] ?? 'misc';
  const fields: BibField[] = [];
  const add = (name: string, value: string | undefined) => {
    if (value) fields.push({ name, value });
  };
  const container = str(r['container-title']);
  const publisher = str(r.publisher);

  add('author', names(r.author));
  add('editor', names(r.editor));
  const title = str(r.title);
  // Only titles are lower-cased by BibTeX styles, so only they are protected.
  add('title', title && text(title, true));
  if (type === 'article') add('journal', container && text(container));
  else if (type === 'incollection' || type === 'inproceedings')
    add('booktitle', container && text(container));
  add(
    'series',
    str(r['collection-title']) && text(str(r['collection-title'])!)
  );
  add('edition', str(r.edition));
  add('volume', str(r.volume));
  add('number', str(r.issue ?? r.number)?.replace(/\s*[-–]\s*/g, '--'));
  add('pages', str(r.page)?.replace(/\s*[-–]\s*/g, '--'));
  const publisherField =
    type === 'techreport'
      ? 'institution'
      : type === 'phdthesis'
        ? 'school'
        : 'publisher';
  add(publisherField, publisher && plain(publisher));
  add(
    'address',
    str(r['publisher-place']) && plain(str(r['publisher-place'])!)
  );
  const d = date(r);
  if (d) {
    add('year', String(d[0]));
    if (d[1] >= 1 && d[1] <= 12)
      fields.push({ name: 'month', value: MONTHS[d[1] - 1], macro: true });
  }
  add('isbn', str(r.ISBN));
  add('doi', str(r.DOI));
  const url = str(r.URL);
  if (url && !isDoiUrl(url)) add('url', url);
  return { type, fields };
}
