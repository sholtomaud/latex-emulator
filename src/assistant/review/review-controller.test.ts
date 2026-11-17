import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryReviewed,
  ReviewController,
  reviewStatus,
} from './review-controller.ts';
import type { ReviewJob } from './review-controller.ts';

const P = (word: string) =>
  `${word} is a paragraph with more than enough letters in it to be reviewed by the agent.`;
const doc = (...ps: string[]) =>
  `\\documentclass{article}\n\\begin{document}\n${ps.join('\n\n')}\n\\end{document}\n`;

/** Let the queue run until it waits on a review, a timer or nothing. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

interface Pending {
  job: ReviewJob;
  signal: AbortSignal;
  resolve: (s: string) => void;
  reject: (e: Error) => void;
}

function make({ idle = 1000 } = {}) {
  let now = 0;
  let timer: (() => void) | null = null;
  const pending: Pending[] = [];
  const reviewed = new MemoryReviewed();
  const c = new ReviewController({
    reviewed,
    now: () => now,
    setTimer: (fn) => {
      timer = fn;
      return fn;
    },
    clearTimer: (h) => {
      if (timer === h) timer = null;
    },
    idle,
    hash: async (text) => `k:${text}`,
    review: (job, signal) =>
      new Promise<string>((resolve, reject) => {
        pending.push({ job, signal, resolve, reject });
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  /** The writer pauses: time passes and the idle timer fires. */
  const pause = async () => {
    now += idle;
    const fire = timer;
    timer = null;
    fire?.();
    await flush();
  };
  /** The review in flight finishes; wait for the next to start (or none). */
  const finish = async (summary = 'Done.') => {
    pending.shift()!.resolve(summary);
    await flush();
  };
  const text = (p: Pending) => p.job.paragraphs[p.job.index].text;
  return {
    c,
    pending,
    reviewed,
    pause,
    finish,
    text,
    edit: (source: string) => {
      now += 10;
      c.changed(source);
    },
    hasTimer: () => !!timer,
    advance: (ms: number) => (now += ms),
  };
}

test('off: editing reviews nothing', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One')), false);
  t.edit(doc(P('One'), P('Two')));
  assert.equal(t.hasTimer(), false);
  await t.pause();
  assert.equal(t.pending.length, 0);
});

test('as you write: after a pause, each paragraph is reviewed once, in order, one at a time', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One'), P('Two')), true);
  await t.pause();
  assert.equal(t.pending.length, 1);
  assert.equal(t.text(t.pending[0]), P('One'));
  assert.equal(t.c.store.getState().reviewing, 0);
  await t.finish();
  assert.equal(t.text(t.pending[0]), P('Two'));
  await t.finish('Left one comment.');
  assert.equal(t.pending.length, 0);
  const s = t.c.store.getState();
  assert.equal(s.reviewing, null);
  assert.equal(s.pending, 0);
  assert.equal(s.last, 'Left one comment.');
  // Nothing changed: nothing is sent again.
  t.edit(doc(P('One'), P('Two')));
  await t.pause();
  assert.equal(t.pending.length, 0);
});

test('an edit sends only the paragraph that changed', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One'), P('Two'), P('Three')), true);
  await t.pause();
  await t.finish();
  await t.finish();
  await t.finish();
  t.edit(doc(P('One'), P('Two!'), P('Three')));
  await t.pause();
  assert.deepEqual(t.pending.map(t.text), [P('Two!')]);
});

test('typing pauses the queue; it goes on at the next pause', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One'), P('Two')), true);
  await t.pause();
  t.edit(doc(P('One'), P('Two'), P('Thr')));
  await t.finish();
  // Typed just now: the next paragraph waits.
  assert.equal(t.pending.length, 0);
  assert.equal(t.hasTimer(), true);
  assert.equal(t.c.store.getState().pending, 2);
  await t.pause();
  assert.equal(t.text(t.pending[0]), P('Two'));
});

test('a paragraph that changes while under review is cancelled, and reviewed again as it is now', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One')), true);
  await t.pause();
  const first = t.pending[0];
  t.edit(doc(P('One more')));
  assert.equal(first.signal.aborted, true);
  t.pending.shift();
  await flush();
  await t.pause();
  assert.equal(t.text(t.pending[0]), P('One more'));
});

test('a failure pauses the reviewer and says why; reviewing the whole document resumes it', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One'), P('Two')), true);
  await t.pause();
  t.pending.shift()!.reject(new Error('HTTP 401: invalid key'));
  await flush();
  assert.equal(t.c.store.getState().error, 'HTTP 401: invalid key');
  t.edit(doc(P('One'), P('Two'), P('Three')));
  assert.equal(t.hasTimer(), false);
  t.c.reviewWhole();
  await flush();
  assert.equal(t.c.store.getState().error, '');
  assert.equal(t.text(t.pending[0]), P('One'));
});

test('review the whole document: works with "as I write" off, then stops', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One'), P('Two')), false);
  t.c.reviewWhole();
  await flush();
  assert.equal(t.c.store.getState().whole, true);
  await t.finish();
  await t.finish();
  assert.equal(t.c.store.getState().whole, false);
  t.edit(doc(P('One'), P('Two'), P('Three')));
  assert.equal(t.hasTimer(), false);
});

test('stop: the paragraph in flight is cancelled and the queue waits', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One'), P('Two')), false);
  t.c.reviewWhole();
  await flush();
  const first = t.pending[0];
  t.c.stop();
  assert.equal(first.signal.aborted, true);
  await flush();
  t.pending.shift();
  assert.equal(t.pending.length, 0);
  assert.equal(t.c.store.getState().whole, false);
});

test('turning it off cancels the review in flight', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One')), true);
  await t.pause();
  const first = t.pending[0];
  t.c.setOn(false);
  assert.equal(first.signal.aborted, true);
  assert.equal(t.hasTimer(), false);
});

test('reviewed paragraphs are remembered per document, and only those still in it', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One'), P('Two')), true);
  await t.pause();
  await t.finish();
  await t.finish();
  assert.equal((await t.reviewed.get('d'))!.length, 2);
  // Another document has its own; coming back, nothing is sent again.
  await t.c.openDocument('e', doc(P('Other')), false);
  await t.c.openDocument('d', doc(P('One'), P('Two')), true);
  await t.pause();
  assert.equal(t.pending.length, 0);
  // A deleted paragraph is forgotten when the next review is saved.
  t.edit(doc(P('Two'), P('New')));
  await t.pause();
  await t.finish();
  assert.equal((await t.reviewed.get('d'))!.length, 2);
});

test('switching documents cancels a review of the old one', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One')), true);
  await t.pause();
  const first = t.pending[0];
  await t.c.openDocument('e', doc(P('Other')), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(t.c.store.getState().documentId, 'e');
});

test('the status line says what the reviewer is doing', () => {
  const base = {
    documentId: 'd',
    on: true,
    whole: false,
    reviewing: null,
    total: 4,
    pending: 0,
    error: '',
    last: '',
  };
  assert.equal(reviewStatus({ ...base, on: false }), '');
  assert.equal(
    reviewStatus({ ...base, reviewing: 1, pending: 3 }),
    'Reviewing paragraph 2 of 4…'
  );
  assert.equal(
    reviewStatus({ ...base, pending: 2 }),
    '2 paragraphs to review when you pause.'
  );
  assert.equal(
    reviewStatus({ ...base, pending: 1 }),
    '1 paragraph to review when you pause.'
  );
  assert.equal(
    reviewStatus({ ...base, last: 'Left a comment.' }),
    'All paragraphs reviewed. Last: Left a comment.'
  );
  assert.equal(
    reviewStatus({ ...base, error: 'HTTP 500' }),
    'Review paused: HTTP 500'
  );
  assert.equal(
    reviewStatus({ ...base, on: false, whole: true, pending: 2 }),
    '2 paragraphs to review.'
  );
});

test('a failure ends a whole-document review, so it can be started again', async () => {
  const t = make();
  await t.c.openDocument('d', doc(P('One')), false);
  t.c.reviewWhole();
  await flush();
  t.pending.shift()!.reject(new Error('model not loaded'));
  await flush();
  assert.equal(t.c.store.getState().whole, false);
  assert.equal(t.c.store.getState().error, 'model not loaded');
});
