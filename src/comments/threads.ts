/**
 * Comment threads (ADR 0025): anchored to the source, with messages from
 * the author ("you") or the assistant. The assistant may reply anywhere
 * but resolves only the threads it opened. Pure.
 */
import type { Anchor } from './anchors.ts';

export type Author = 'you' | 'assistant';

export interface Message {
  author: Author;
  text: string;
  /** ms since the epoch */
  at: number;
}

export interface Thread {
  id: string;
  anchor: Anchor;
  openedBy: Author;
  status: 'open' | 'resolved';
  messages: Message[];
  updatedAt: number;
}

export function newThread(t: {
  id: string;
  anchor: Anchor;
  author: Author;
  text: string;
  at: number;
}): Thread {
  return {
    id: t.id,
    anchor: t.anchor,
    openedBy: t.author,
    status: 'open',
    messages: [{ author: t.author, text: t.text.trim(), at: t.at }],
    updatedAt: t.at,
  };
}

export function addMessage(
  thread: Thread,
  author: Author,
  text: string,
  at: number
): Thread {
  const body = text.trim();
  if (!body) return thread;
  return {
    ...thread,
    messages: [...thread.messages, { author, text: body, at }],
    updatedAt: at,
  };
}

/** You resolve any thread; the assistant only those it opened. */
export const canResolve = (thread: Thread, who: Author) =>
  who === 'you' || thread.openedBy === 'assistant';

export function setResolved(
  thread: Thread,
  resolved: boolean,
  who: Author,
  at: number
): Thread {
  if (!canResolve(thread, who)) return thread;
  return { ...thread, status: resolved ? 'resolved' : 'open', updatedAt: at };
}

/**
 * Open threads first, then resolved; each in document order, with those
 * whose text is gone (a collapsed anchor) at the end.
 */
export function sortThreads(threads: Thread[]): Thread[] {
  const lost = (t: Thread) => (t.anchor.end > t.anchor.start ? 0 : 1);
  return [...threads].sort(
    (a, b) =>
      (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
      lost(a) - lost(b) ||
      a.anchor.start - b.anchor.start
  );
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isAuthor = (v: unknown): v is Author => v === 'you' || v === 'assistant';

function parseThread(v: unknown): Thread | null {
  if (!isObj(v) || typeof v.id !== 'string' || !isObj(v.anchor)) return null;
  const a = v.anchor;
  if (!isNum(a.start) || !isNum(a.end) || typeof a.quote !== 'string')
    return null;
  if (!isAuthor(v.openedBy) || (v.status !== 'open' && v.status !== 'resolved'))
    return null;
  if (!Array.isArray(v.messages) || !isNum(v.updatedAt)) return null;
  const messages: Message[] = [];
  for (const m of v.messages) {
    if (
      !isObj(m) ||
      !isAuthor(m.author) ||
      typeof m.text !== 'string' ||
      !isNum(m.at)
    )
      return null;
    messages.push({ author: m.author, text: m.text, at: m.at });
  }
  return {
    id: v.id,
    anchor: { start: a.start, end: a.end, quote: a.quote },
    openedBy: v.openedBy,
    status: v.status,
    messages,
    updatedAt: v.updatedAt,
  };
}

/** Threads read from storage or a backup: malformed ones are dropped. */
export function parseThreads(v: unknown): Thread[] {
  if (!Array.isArray(v)) return [];
  return v.map(parseThread).filter((t): t is Thread => t !== null);
}
