import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CommentsController, MemoryThreads } from './comments-controller.ts';

function make() {
  const store = new MemoryThreads();
  let n = 0;
  let now = 1000;
  const c = new CommentsController({
    store,
    newId: () => `t${++n}`,
    now: () => now++,
  });
  return { c, store };
}

const SRC = 'Energy is the currency. Emergy is memory.';

describe('CommentsController', () => {
  test('commenting on a selection: a draft with its quote, then a thread', async () => {
    const { c, store } = make();
    await c.openDocument('d1', SRC);
    c.startComment({ start: 0, end: 6 });
    assert.deepEqual(c.store.getState().draft, {
      start: 0,
      end: 6,
      quote: 'Energy',
    });
    await c.addDraft('Define it?');
    const [t] = c.store.getState().threads;
    assert.equal(t.id, 't1');
    assert.deepEqual(t.anchor, { start: 0, end: 6, quote: 'Energy' });
    assert.equal(t.openedBy, 'you');
    assert.equal(c.store.getState().draft, null);
    assert.equal(c.store.getState().focus, 't1');
    assert.deepEqual(await store.get('d1'), [t]);
  });

  test('an empty selection or an empty comment makes nothing', async () => {
    const { c } = make();
    await c.openDocument('d1', SRC);
    c.startComment({ start: 3, end: 3 });
    assert.equal(c.store.getState().draft, null);
    c.startComment({ start: 0, end: 6 });
    await c.addDraft('   ');
    assert.deepEqual(c.store.getState().threads, []);
    c.cancelDraft();
    assert.equal(c.store.getState().draft, null);
  });

  test('edits move the threads and refresh their quotes; saving waits for a pause', async () => {
    const { c, store } = make();
    await c.openDocument('d1', SRC);
    c.startComment({ start: 24, end: 30 }); // "Emergy"
    await c.addDraft('Cite Odum.');
    const next = `Note. ${SRC}`;
    c.applyEdits([{ offset: 0, removed: 0, inserted: 6 }], next);
    assert.deepEqual(c.store.getState().threads[0].anchor, {
      start: 30,
      end: 36,
      quote: 'Emergy',
    });
    // Typing inside the range updates the quote.
    const typed = next.replace('Emergy', 'Emxergy');
    c.applyEdits([{ offset: 32, removed: 0, inserted: 1 }], typed);
    assert.equal(c.store.getState().threads[0].anchor.quote, 'Emxergy');
    await c.flush();
    assert.equal((await store.get('d1'))![0].anchor.quote, 'Emxergy');
  });

  test('several edits in one change apply from the end, so offsets stay right', () => {
    const { c } = make();
    void c.openDocument('d1', SRC);
    c.store.setState({
      threads: [
        {
          id: 'x',
          anchor: { start: 24, end: 30, quote: 'Emergy' },
          openedBy: 'you',
          status: 'open',
          messages: [],
          updatedAt: 1,
        },
      ],
    });
    // Two insertions in the old text's offsets: "A" at 0, "B" at 10.
    const next = `A${SRC.slice(0, 10)}B${SRC.slice(10)}`;
    c.applyEdits(
      [
        { offset: 0, removed: 0, inserted: 1 },
        { offset: 10, removed: 0, inserted: 1 },
      ],
      next
    );
    assert.deepEqual(c.store.getState().threads[0].anchor, {
      start: 26,
      end: 32,
      quote: 'Emergy',
    });
  });

  test('a change made elsewhere: threads found again by their quotes, or marked lost', async () => {
    const { c } = make();
    await c.openDocument('d1', SRC);
    c.startComment({ start: 0, end: 6 });
    await c.addDraft('a');
    c.startComment({ start: 24, end: 30 });
    await c.addDraft('b');
    c.sourceReplaced('New intro. Energy matters.');
    const [energy, emergy] = c.store.getState().threads;
    assert.deepEqual(energy.anchor, { start: 11, end: 17, quote: 'Energy' });
    // Gone: collapsed, quote kept, still listed.
    assert.equal(emergy.anchor.start, emergy.anchor.end);
    assert.equal(emergy.anchor.quote, 'Emergy');
    assert.equal(c.isLost(emergy), true);
    assert.equal(c.isLost(energy), false);
  });

  test('reply, resolve and reopen; the assistant can’t resolve your thread', async () => {
    const { c } = make();
    await c.openDocument('d1', SRC);
    c.startComment({ start: 0, end: 6 });
    await c.addDraft('Define it?');
    await c.reply('t1', 'assistant', 'Energy: capacity to do work.');
    await c.resolve('t1', true, 'assistant');
    assert.equal(c.store.getState().threads[0].status, 'open');
    await c.resolve('t1', true, 'you');
    assert.equal(c.store.getState().threads[0].status, 'resolved');
    await c.resolve('t1', false, 'you');
    assert.equal(c.store.getState().threads[0].messages.length, 2);
    assert.equal(c.store.getState().threads[0].status, 'open');
  });

  test('each document has its own threads; a deleted document’s go too', async () => {
    const { c, store } = make();
    await c.openDocument('d1', SRC);
    c.startComment({ start: 0, end: 6 });
    await c.addDraft('a');
    await c.openDocument('d2', 'Other text.');
    assert.deepEqual(c.store.getState().threads, []);
    await c.openDocument('d1', SRC);
    assert.equal(c.store.getState().threads.length, 1);
    await c.forget('d1');
    assert.equal(await store.get('d1'), undefined);
  });
});
