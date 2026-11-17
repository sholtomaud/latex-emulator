/**
 * The reviewing agent's unit of work (ADR 0025 §3): the body's paragraphs,
 * their keys, the threads on each, and what the model is told. Pure.
 */
import type { Thread } from '../../comments/threads.ts';

export interface Paragraph {
  /** UTF-16 offsets into the source, as the editor and comments use. */
  start: number;
  end: number;
  text: string;
}

/** Environments whose text is not prose, kept whole even across blank lines. */
const CODE =
  /\\begin\{(lstlisting|verbatim\*?|algorithmic)\}[\s\S]*?\\end\{\1\}/g;

/** Commands whose arguments are names, keys or headings, not prose. */
const NOT_PROSE =
  /\\(?:(?:sub)*section|paragraph|label|ref|eqref|pageref|cite[a-z]*|nocite|includegraphics|bibliography(?:style)?|usepackage|documentclass|title|author|date)\*?(?:\[[^\]]*\])*(?:\{[^}]*\})?/g;

/** Letters of prose a block needs to be worth reviewing. */
const MIN_LETTERS = 40;

const prose = (text: string) =>
  text
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(NOT_PROSE, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ');

const isProse = (text: string) =>
  (prose(text).match(/\p{L}/gu) ?? []).length >= MIN_LETTERS;

/** The body's paragraphs (blank-line separated) that hold prose. */
export function paragraphs(source: string): Paragraph[] {
  const begin = source.indexOf('\\begin{document}');
  const from = begin >= 0 ? begin + '\\begin{document}'.length : 0;
  const endAt = source.indexOf('\\end{document}', from);
  const to = endAt >= 0 ? endAt : source.length;
  const code = [...source.matchAll(CODE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  const inCode = (i: number) => code.some((c) => i >= c.start && i < c.end);
  const blocks: { start: number; end: number }[] = [];
  let start = from;
  for (const m of source
    .slice(from, to)
    .matchAll(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g)) {
    const at = from + m.index;
    if (inCode(at)) continue;
    blocks.push({ start, end: at });
    start = at + m[0].length;
  }
  blocks.push({ start, end: to });
  const out: Paragraph[] = [];
  for (const b of blocks) {
    const raw = source.slice(b.start, b.end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const s = b.start + lead;
    if (!text || code.some((c) => s < c.end && s + text.length > c.start))
      continue;
    if (isProse(text)) out.push({ start: s, end: s + text.length, text });
  }
  return out;
}

/**
 * A reviewed paragraph's key: the SHA-256 of its text. Neighbours are only
 * context, so an edit doesn't send the paragraphs around it again.
 */
export async function reviewKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Where a paragraph's text is now, nearest where it was; null if gone. */
export function findParagraph(
  source: string,
  text: string,
  near: number
): { start: number; end: number } | null {
  let best = -1;
  for (let i = source.indexOf(text); i >= 0; i = source.indexOf(text, i + 1))
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  return best < 0 ? null : { start: best, end: best + text.length };
}

/** The threads on a paragraph: their text overlaps it. */
export const threadsIn = (
  threads: Thread[],
  p: { start: number; end: number }
) =>
  threads.filter(
    (t) =>
      t.anchor.end > t.anchor.start &&
      t.anchor.start < p.end &&
      t.anchor.end > p.start
  );

/**
 * What the reviewer does (fixed text, after the chat's instructions and
 * tool guide, so prompt caches keep all three).
 */
export const REVIEW_GUIDE = `You are reviewing the author's document one paragraph at a time, as they write. Work with your tools, then end with one short line saying what you did. Don't ask the author questions: they aren't watching the chat.

- Comment (comment_add) only where it is needed: a claim without support, an unclear or ambiguous sentence, a factual or logical problem. At most three comments; none is fine. Quote exactly from the paragraph under review, never from its neighbours. Don't repeat a comment already in a thread.
- Answer the author's open comments on this paragraph (comment_reply). You may say a thread can be resolved, but resolve only threads you opened (comment_resolve), once the text addresses them.
- For each citation in the paragraph, make a zettel of each claim the author makes with it, in the author's words: first zettel_search so you don't repeat one, find the cited item with search_items (by its citation key, else its title), then zettel_create linked to it. New zettels go to zk/inbox for the author to accept. If Zotero isn't connected, skip the zettels and say so.`;

/** The message asking for one paragraph's review. */
export function reviewMessage(o: {
  name: string;
  source: string;
  paragraphs: Paragraph[];
  index: number;
  threads: Thread[];
}): string {
  const p = o.paragraphs[o.index];
  const line = o.source.slice(0, p.start).split('\n').length;
  const lines = p.text.split('\n').length;
  const where =
    lines > 1 ? `lines ${line}–${line + lines - 1}` : `line ${line}`;
  const block = (tag: string, text = '(none)') =>
    `<${tag}>\n${text}\n</${tag}>`;
  const threads = o.threads.length
    ? `\n${JSON.stringify(
        o.threads.map((t) => ({
          id: t.id,
          quote: t.anchor.quote,
          openedBy: t.openedBy,
          status: t.status,
          messages: t.messages.map((m) => ({ author: m.author, text: m.text })),
        }))
      )}`
    : ' none.';
  return `Review paragraph ${o.index + 1} of ${o.paragraphs.length} of “${o.name}” (${where}). The paragraphs before and after are context only.

${block('before', o.paragraphs[o.index - 1]?.text)}

${block('paragraph', p.text)}

${block('after', o.paragraphs[o.index + 1]?.text)}

Comment threads on this paragraph (openedBy: you = the author, assistant = you):${threads}`;
}
