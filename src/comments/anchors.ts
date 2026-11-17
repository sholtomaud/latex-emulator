/**
 * Where a comment is (ADR 0025): a range of the source, kept in step with
 * every edit, and found again by its quote after a change made elsewhere.
 * Offsets are UTF-16, as Monaco's. Pure.
 */

export interface Range {
  start: number;
  end: number;
}

export interface Anchor extends Range {
  /** The text it was on, to find it again. */
  quote: string;
}

/** An edit: `removed` characters at `offset` replaced by `inserted` ones. */
export interface Edit {
  offset: number;
  removed: number;
  inserted: number;
}

/**
 * The range after one edit. Text typed at either edge stays outside it;
 * text removed from it shrinks it; when all of it goes, it collapses
 * (start === end), which means its text is gone.
 */
export function shiftAnchor<T extends Range>(range: T, e: Edit): T {
  const after = e.offset + e.removed;
  const delta = e.inserted - e.removed;
  const start =
    range.start < e.offset
      ? range.start
      : range.start >= after
        ? range.start + delta
        : e.offset + e.inserted;
  const end =
    range.end <= e.offset
      ? range.end
      : range.end >= after
        ? range.end + delta
        : e.offset;
  return { ...range, start: Math.min(start, end), end };
}

/** The anchor in `text`: where it was, else its quote nearest there. */
export function reanchor(text: string, anchor: Anchor): Range | null {
  const { quote } = anchor;
  if (!quote) return null;
  if (text.slice(anchor.start, anchor.end) === quote)
    return { start: anchor.start, end: anchor.end };
  let best: number | null = null;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1))
    if (
      best === null ||
      Math.abs(i - anchor.start) < Math.abs(best - anchor.start)
    )
      best = i;
  return best === null ? null : { start: best, end: best + quote.length };
}
