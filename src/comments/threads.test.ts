import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMessage,
  canResolve,
  newThread,
  parseThreads,
  setResolved,
  sortThreads,
} from './threads.ts';

const at = 1000;
const t = newThread({
  id: 't1',
  anchor: { start: 5, end: 9, quote: 'word' },
  author: 'you',
  text: '  Unclear?  ',
  at,
});

describe('comment threads', () => {
  test('a new thread: open, its first message trimmed, opened by its author', () => {
    assert.deepEqual(t, {
      id: 't1',
      anchor: { start: 5, end: 9, quote: 'word' },
      openedBy: 'you',
      status: 'open',
      messages: [{ author: 'you', text: 'Unclear?', at }],
      updatedAt: at,
    });
  });

  test('replies add messages; blank ones are ignored', () => {
    const r = addMessage(t, 'assistant', 'It reads as a definition.', 2000);
    assert.equal(r.messages.length, 2);
    assert.equal(r.updatedAt, 2000);
    assert.equal(addMessage(t, 'you', '   ', 3000), t);
  });

  test('the assistant resolves only threads it opened; you resolve any', () => {
    const mine = newThread({
      id: 't2',
      anchor: t.anchor,
      author: 'assistant',
      text: 'Says who?',
      at,
    });
    assert.equal(canResolve(t, 'you'), true);
    assert.equal(canResolve(mine, 'you'), true);
    assert.equal(canResolve(mine, 'assistant'), true);
    assert.equal(canResolve(t, 'assistant'), false);
    assert.equal(setResolved(t, true, 'assistant', 2000), t);
    const done = setResolved(t, true, 'you', 2000);
    assert.equal(done.status, 'resolved');
    assert.equal(setResolved(done, false, 'you', 3000).status, 'open');
  });

  test('order: open threads first, each group in document order', () => {
    const x = (id: string, start: number, status: 'open' | 'resolved') => ({
      ...t,
      id,
      status,
      anchor: { start, end: start + 1, quote: 'q' },
    });
    assert.deepEqual(
      sortThreads([
        x('a', 50, 'resolved'),
        x('b', 40, 'open'),
        x('c', 10, 'resolved'),
        x('d', 5, 'open'),
      ]).map((y) => y.id),
      ['d', 'b', 'c', 'a']
    );
  });

  test('a thread whose text is gone goes to the end of its group', () => {
    const lost = { ...t, id: 'lost', anchor: { start: 0, end: 0, quote: 'q' } };
    const found = {
      ...t,
      id: 'found',
      anchor: { start: 40, end: 45, quote: 'q' },
    };
    assert.deepEqual(
      sortThreads([lost, found]).map((y) => y.id),
      ['found', 'lost']
    );
  });

  test('stored or restored threads are checked; bad ones are dropped', () => {
    const good = JSON.parse(JSON.stringify(t));
    assert.deepEqual(
      parseThreads([good, { id: 3 }, null, { ...good, status: 'x' }]),
      [t]
    );
    assert.deepEqual(parseThreads('nope'), []);
    assert.deepEqual(
      parseThreads([
        { ...good, messages: [{ author: 'mallory', text: 'x', at: 1 }] },
      ]),
      []
    );
  });
});
