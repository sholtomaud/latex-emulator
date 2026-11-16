/**
 * Zettels as Zotero notes (ADR 0024 §4). The note's first line is
 * `<Luhmann ID> <declarative title>` (written as a heading, which Zotero
 * shows as the note's title); the rest is the body. The ID lives only
 * there, so it can't disagree with anything else. Pure.
 */
import { isId } from './luhmann.ts';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#')
      return String.fromCodePoint(
        name[1].toLowerCase() === 'x'
          ? parseInt(name.slice(2), 16)
          : Number(name.slice(1))
      );
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

/** The note's text: one line per <br> or list item, a blank line between blocks. */
export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/(p|h[1-6]|div|blockquote|pre|ul|ol)>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A new zettel's note: the ID and title as a heading, then the body. */
export function zettelHtml(id: string, title: string, body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escape(p.trim()).replace(/\n/g, '<br>')}</p>`);
  return [`<h1>${escape(`${id} ${title.trim()}`)}</h1>`, ...paragraphs].join(
    '\n'
  );
}

export interface ZettelText {
  id: string;
  title: string;
  body: string;
}

/** A zettel's ID, title and body; null for a note that isn't one. */
export function parseZettel(html: string): ZettelText | null {
  const text = htmlToText(html);
  const newline = text.indexOf('\n');
  const first = newline < 0 ? text : text.slice(0, newline);
  const m = /^(\S+)\s+(\S.*)$/.exec(first.trim());
  if (!m || !isId(m[1])) return null;
  return {
    id: m[1],
    title: m[2].trim(),
    body: newline < 0 ? '' : text.slice(newline + 1).trim(),
  };
}

/** Change the first line only, keeping the rest of the note as it is. */
export function retitle(html: string, line: string): string {
  const first = /<(h[1-6]|p)\b([^>]*)>[\s\S]*?<\/\1>/i.exec(html);
  if (!first) return `<h1>${escape(line)}</h1>${html}`;
  const replacement =
    first[1].toLowerCase() === 'h1'
      ? `<h1${first[2]}>${escape(line)}</h1>`
      : `<h1>${escape(line)}</h1>`;
  return (
    html.slice(0, first.index) +
    replacement +
    html.slice(first.index + first[0].length)
  );
}
