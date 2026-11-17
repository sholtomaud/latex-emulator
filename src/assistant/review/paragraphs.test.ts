import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_GUIDE,
  findParagraph,
  paragraphs,
  reviewKey,
  reviewMessage,
  threadsIn,
} from './paragraphs.ts';
import type { Thread } from '../../comments/threads.ts';

const PROSE_A =
  'Energy is the currency of all systems, and its flows shape them \\citep{odum_environmental_1996}.';
const PROSE_B =
  'Each transformation degrades some energy, so hierarchies form in every ecosystem we study.';

const doc = (body: string) =>
  `\\documentclass{article}\n\\title{A long title of the document here}\n\\begin{document}\n${body}\n\\end{document}\n`;

test('paragraphs are the body’s blank-line separated blocks, with their offsets', () => {
  const source = doc(`${PROSE_A}\n\n  \n${PROSE_B}`);
  const ps = paragraphs(source);
  assert.deepEqual(
    ps.map((p) => p.text),
    [PROSE_A, PROSE_B]
  );
  for (const p of ps) assert.equal(source.slice(p.start, p.end), p.text);
});

test('headings, commands and short lines are not paragraphs to review', () => {
  const ps = paragraphs(
    doc(
      `\\maketitle\n\n\\section{Introduction}\\label{sec:intro}\n\n${PROSE_A}\n\n% ${PROSE_B}\n\nToo short.`
    )
  );
  assert.deepEqual(
    ps.map((p) => p.text),
    [PROSE_A]
  );
});

test('code and verbatim are skipped whole, blank lines inside them too', () => {
  const ps = paragraphs(
    doc(
      `\\begin{lstlisting}\nsome code with enough letters to look like prose\n\nmore code with enough letters to look like prose too\n\\end{lstlisting}\n\n${PROSE_B}`
    )
  );
  assert.deepEqual(
    ps.map((p) => p.text),
    [PROSE_B]
  );
});

test('without \\begin{document}, the whole text is the body', () => {
  assert.deepEqual(
    paragraphs(`${PROSE_A}\r\n\r\n${PROSE_B}`).map((p) => p.text),
    [PROSE_A, PROSE_B]
  );
});

test('a paragraph is keyed by its text alone: neighbours and offsets don’t matter', async () => {
  const k = await reviewKey(PROSE_A);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(k, await reviewKey(PROSE_A));
  assert.notEqual(k, await reviewKey(PROSE_B));
});

test('a paragraph is found again after edits elsewhere, nearest its old place', () => {
  const text = 'Same words.';
  const source = `${text} gap ${text} gap`;
  assert.deepEqual(findParagraph(source, text, 13), { start: 16, end: 27 });
  assert.deepEqual(findParagraph(source, text, 2), { start: 0, end: 11 });
  assert.equal(findParagraph(source, 'Gone.', 0), null);
});

const thread = (
  start: number,
  end: number,
  extra: Partial<Thread> = {}
): Thread => ({
  id: `t${start}`,
  anchor: { start, end, quote: 'q' },
  openedBy: 'you',
  status: 'open',
  messages: [{ author: 'you', text: 'Why?', at: 1 }],
  updatedAt: 1,
  ...extra,
});

test('the threads on a paragraph: those whose text overlaps it, lost ones not', () => {
  const p = { start: 10, end: 20, text: '' };
  const ids = threadsIn(
    [
      thread(0, 10),
      thread(5, 11),
      thread(19, 30),
      thread(20, 25),
      thread(12, 12),
    ],
    p
  ).map((t) => t.id);
  assert.deepEqual(ids, ['t5', 't19']);
});

test('the review message gives the paragraph, its neighbours for context, and its threads', () => {
  const source = doc(`${PROSE_A}\n\n${PROSE_B}`);
  const ps = paragraphs(source);
  const m = reviewMessage({
    name: 'Thesis',
    source,
    paragraphs: ps,
    index: 1,
    threads: [thread(ps[1].start, ps[1].start + 6, { id: 'abc' })],
  });
  assert.match(m, /^Review paragraph 2 of 2 of “Thesis” \(line 6\)\./);
  assert.ok(m.includes(`<before>\n${PROSE_A}\n</before>`));
  assert.ok(m.includes(`<paragraph>\n${PROSE_B}\n</paragraph>`));
  assert.ok(m.includes('<after>\n(none)\n</after>'));
  assert.ok(m.includes('"id":"abc"'));
  assert.ok(m.includes('"openedBy":"you"'));
  const none = reviewMessage({
    name: 'T',
    source,
    paragraphs: ps,
    index: 0,
    threads: [],
  });
  assert.match(none, /Comment threads on this paragraph \(.*\): none\./);
  assert.ok(none.includes('<before>\n(none)\n</before>'));
});

test('the review guide states the rules: own threads only, zettels into the inbox', () => {
  assert.match(REVIEW_GUIDE, /only threads you opened/);
  assert.match(REVIEW_GUIDE, /zk\/inbox/);
  assert.match(REVIEW_GUIDE, /zettel_search/);
});
