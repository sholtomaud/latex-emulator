/**
 * "Clean" a .bib file: canonical layout and small, safe fixes, applied only
 * to the entries BibTeX reads. Text between entries (comments, @string,
 * @preamble, entries BibTeX skips) is kept byte for byte, macros and #
 * concatenations are kept as written, and keys are never renamed (that
 * would break \cite). Pure; no DOM.
 */
import { parseBib } from '../latex/bibtex/bib-parser.ts';

export interface CleanResult {
  text: string;
  /** What changed, one line per fix, e.g. "k: pages 1-2 → 1--2". */
  changes: string[];
}

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
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const DOI_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i;

/** The inner text of a {…}, "…" or numeric value; null for macro expressions. */
function literal(raw: string): string | null {
  if (/^\d+$/.test(raw)) return raw;
  const open = raw[0];
  if (open !== '{' && open !== '"') return null;
  // The opening delimiter must close at the very end (no # concatenation).
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    const closes =
      open === '{'
        ? c === '}' && depth === 0
        : c === '"' && i > 0 && depth === 0;
    if (closes) return i === raw.length - 1 ? raw.slice(1, -1) : null;
  }
  return null;
}

function month(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\.$/, '');
  if (/^\d{1,2}$/.test(v) && +v >= 1 && +v <= 12) return MONTHS[+v - 1];
  const i = MONTH_NAMES.findIndex((m) => m === v || m.slice(0, 3) === v);
  return i === -1 ? null : MONTHS[i];
}

export function cleanBib(text: string): CleanResult {
  const changes: string[] = [];
  const { entries } = parseBib(text);
  let out = '';
  let pos = 0;
  for (const entry of entries) {
    const note = (what: string) => changes.push(`${entry.key}: ${what}`);
    const rawDoi = entry.raw.get('doi');
    const doi = rawDoi && literal(rawDoi)?.trim().replace(DOI_PREFIX, '');
    const lines: string[] = [];
    for (const [name, raw] of entry.raw) {
      const inner = literal(raw);
      if (inner === null) {
        lines.push(`  ${name} = ${raw},`); // a macro expression: as written
        continue;
      }
      let value = inner.replace(/\s+/g, ' ').trim();
      if (!value) {
        note(`removed empty ${name}`);
        continue;
      }
      if (name === 'doi' && DOI_PREFIX.test(value)) {
        value = value.replace(DOI_PREFIX, '');
        note('doi without its URL prefix');
      }
      if (
        name === 'url' &&
        doi &&
        DOI_PREFIX.test(value) &&
        value.replace(DOI_PREFIX, '').toLowerCase() === doi.toLowerCase()
      ) {
        note('removed url (the DOI link)');
        continue;
      }
      if (name === 'pages' || name === 'number') {
        const fixed = value.replace(/(\w)\s*(?:-|–)\s*(?=\w)/g, '$1--');
        if (fixed !== value && !/---/.test(fixed)) {
          note(`${name} ${value} → ${fixed}`);
          value = fixed;
        }
      }
      if (name === 'month') {
        const macro = month(value);
        if (macro) {
          if (macro !== value) note(`month ${value} → ${macro}`);
          lines.push(`  month = ${macro},`);
          continue;
        }
      }
      lines.push(`  ${name} = {${value}},`);
    }
    out += text.slice(pos, entry.span.start);
    out += `@${entry.type}{${entry.key},\n${lines.join('\n')}\n}`;
    pos = entry.span.end;
  }
  out += text.slice(pos);
  // A file ending right after an entry gets a final newline.
  return {
    text: out.endsWith('\n') || !entries.length ? out : `${out}\n`,
    changes,
  };
}
