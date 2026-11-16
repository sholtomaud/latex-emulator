/**
 * Luhmann IDs (ADR 0024 §4): segments that alternate numbers and letters,
 * starting with a number: `1`, `1a`, `1a2`, `21b3c`. Letters count a…z, aa,
 * ab… so a branch never runs out. A branch sorts right after its parent
 * and before the parent's next sibling (`1a2`, `1a2a`, `1a3`). Pure.
 */

type Segment = { kind: 'n'; value: number } | { kind: 'l'; value: string };

const SEGMENTS = /([1-9]\d*)|([a-z]+)/g;

function segments(id: string): Segment[] {
  return [...id.matchAll(SEGMENTS)].map((m) =>
    m[1] !== undefined
      ? { kind: 'n', value: Number(m[1]) }
      : { kind: 'l', value: m[2] }
  );
}

const join = (segs: Segment[]) => segs.map((s) => String(s.value)).join('');

/** A well-formed ID: numbers (no leading zero) and letters, alternating. */
export function isId(id: string): boolean {
  if (!/^[1-9][0-9a-z]*$/.test(id)) return false;
  const segs = segments(id);
  return (
    join(segs) === id &&
    segs.every((s, i) => s.kind === (i % 2 === 0 ? 'n' : 'l'))
  );
}

/** a…z, then aa, ab… (bijective base 26). */
function letterIndex(s: string): number {
  let n = 0;
  for (const c of s) n = n * 26 + (c.charCodeAt(0) - 96);
  return n;
}

function letters(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const rank = (s: Segment) =>
  s.kind === 'n' ? s.value : letterIndex(s.value as string);

/** For sort(): Luhmann order. */
export function compareIds(a: string, b: string): number {
  const x = segments(a);
  const y = segments(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = rank(x[i]) - rank(y[i]);
    if (d) return d;
  }
  return x.length - y.length;
}

export function parent(id: string): string | null {
  const segs = segments(id);
  return segs.length > 1 ? join(segs.slice(0, -1)) : null;
}

export function nextSibling(id: string): string {
  const segs = segments(id);
  const last = segs[segs.length - 1];
  const next: Segment =
    last.kind === 'n'
      ? { kind: 'n', value: last.value + 1 }
      : { kind: 'l', value: letters(letterIndex(last.value) + 1) };
  return join([...segs.slice(0, -1), next]);
}

/** `id` is `prefix` or lies in its branch (whole segments only). */
export function isUnder(id: string, prefix: string): boolean {
  const x = segments(id);
  const p = segments(prefix);
  return (
    x.length >= p.length &&
    p.every((s, i) => s.kind === x[i].kind && s.value === x[i].value)
  );
}

/** The child after the last existing child of `id`. */
export function firstFreeChild(id: string, taken: Set<string>): string {
  const depth = segments(id).length;
  const children = [...taken].filter(
    (t) => isUnder(t, id) && segments(t).length === depth + 1
  );
  if (!children.length)
    return id + (segments(id).at(-1)!.kind === 'n' ? 'a' : '1');
  return nextSibling(children.sort(compareIds).at(-1)!);
}

/**
 * A note continuing `id`: its next sibling if that is free, otherwise a
 * new branch under `id` (Luhmann's way of inserting between two notes).
 */
export function placeAfter(id: string, taken: Set<string>): string {
  const next = nextSibling(id);
  return taken.has(next) ? firstFreeChild(id, taken) : next;
}

/** The number after the highest top-level number in use. */
export function nextFreeTopLevel(taken: Set<string>): string {
  let max = 0;
  for (const id of taken) {
    const first = segments(id)[0];
    if (first?.kind === 'n') max = Math.max(max, first.value);
  }
  return String(max + 1);
}
