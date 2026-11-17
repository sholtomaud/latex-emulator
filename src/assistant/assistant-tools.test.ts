import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantTools } from './assistant-tools.ts';
import {
  CommentsController,
  MemoryThreads,
} from '../comments/comments-controller.ts';

const SRC = 'Energy is the currency. Energy flows. Emergy is memory.';

async function make(mayRead = true) {
  let n = 0;
  const comments = new CommentsController({
    store: new MemoryThreads(),
    newId: () => `t${++n}`,
    now: () => 1000,
  });
  await comments.openDocument('d1', SRC);
  const zotero: { name: string; args: unknown }[] = [];
  const tools = new AssistantTools({
    document: () => (mayRead ? { name: 'Paper', source: SRC } : null),
    comments,
    zotero: async (name, args) => {
      zotero.push({ name, args });
      return name === 'zettel_create'
        ? { ok: true, result: { zettel: { id: '1', key: 'K', title: 'T' } } }
        : { ok: false, message: 'Zotero: no zettel 9.' };
    },
  });
  return { tools, comments, zotero };
}

const run = async (
  tools: AssistantTools,
  name: string,
  input: Record<string, unknown> = {}
) => tools.run({ id: 'c', name, input });

describe('the assistant’s tools (ADR 0025)', () => {
  test('offered: document, comment and Zotero tools, with JSON Schema parameters', async () => {
    const { tools } = await make();
    const names = tools.definitions().map((d) => d.name);
    for (const n of [
      'document_read',
      'comments_list',
      'comment_add',
      'comment_reply',
      'comment_resolve',
      'search_items',
      'get_item',
      'zettel_list',
      'zettel_get',
      'zettel_search',
      'zettel_create',
      'zettel_update',
      'zettel_link',
      'zettel_unlink',
      'zettel_tag',
    ])
      assert.ok(names.includes(n), n);
    for (const d of tools.definitions())
      assert.equal((d.parameters as { type: string }).type, 'object', d.name);
  });

  test('document_read: the source, numbered by line, only where the author allowed it', async () => {
    const { tools } = await make();
    const r = await run(tools, 'document_read');
    assert.equal(r.isError, undefined);
    assert.match(r.content, /^1\| Energy is the currency\./);
    const denied = await run((await make(false)).tools, 'document_read');
    assert.equal(denied.isError, true);
    assert.match(denied.content, /Let the assistant read this document/);
  });

  test('comment_add anchors to an exact quote; several matches need an occurrence', async () => {
    const { tools, comments } = await make();
    const one = await run(tools, 'comment_add', {
      quote: 'Emergy is memory',
      text: 'Cite Odum.',
    });
    assert.equal(one.isError, undefined);
    const [t] = comments.store.getState().threads;
    assert.deepEqual(t.anchor, {
      start: 38,
      end: 54,
      quote: 'Emergy is memory',
    });
    assert.equal(t.openedBy, 'assistant');

    const twice = await run(tools, 'comment_add', {
      quote: 'Energy',
      text: 'x',
    });
    assert.equal(twice.isError, true);
    assert.match(twice.content, /2 times/);
    const second = await run(tools, 'comment_add', {
      quote: 'Energy',
      text: 'Which energy?',
      occurrence: 2,
    });
    assert.equal(second.isError, undefined);
    assert.ok(
      comments.store.getState().threads.some((x) => x.anchor.start === 24)
    );

    const missing = await run(tools, 'comment_add', {
      quote: 'absent',
      text: 'x',
    });
    assert.equal(missing.isError, true);
    assert.match(missing.content, /not found/);
  });

  test('comments_list, reply, and resolve only its own threads', async () => {
    const { tools, comments } = await make();
    comments.startComment({ start: 0, end: 6 });
    await comments.addDraft('Define?'); // yours
    await run(tools, 'comment_add', { quote: 'Emergy', text: 'Cite.' });
    const list = JSON.parse((await run(tools, 'comments_list')).content);
    assert.deepEqual(
      list.threads.map((t: { quote: string; openedBy: string }) => [
        t.quote,
        t.openedBy,
      ]),
      [
        ['Energy', 'you'],
        ['Emergy', 'assistant'],
      ]
    );
    const [yours, mine] = list.threads;
    assert.equal(
      (
        await run(tools, 'comment_reply', {
          thread_id: yours.id,
          text: 'Capacity to do work.',
        })
      ).isError,
      undefined
    );
    const refused = await run(tools, 'comment_resolve', {
      thread_id: yours.id,
    });
    assert.equal(refused.isError, true);
    assert.match(refused.content, /only the author/);
    assert.equal(
      (await run(tools, 'comment_resolve', { thread_id: mine.id })).isError,
      undefined
    );
    assert.equal(
      comments.store.getState().threads.find((t) => t.id === mine.id)!.status,
      'resolved'
    );
    const unknown = await run(tools, 'comment_reply', {
      thread_id: 'nope',
      text: 'x',
    });
    assert.equal(unknown.isError, true);
  });

  test('comment tools need the author’s permission too: quotes are document text', async () => {
    const { tools } = await make(false);
    for (const name of ['comments_list', 'comment_add'])
      assert.equal(
        (await run(tools, name, { quote: 'Energy', text: 'x' })).isError,
        true,
        name
      );
  });

  test('Zotero tools go to the plugin; its answers and errors come back as results', async () => {
    const { tools, zotero } = await make(false);
    const made = await run(tools, 'zettel_create', { title: 'T' });
    assert.equal(made.isError, undefined);
    assert.deepEqual(JSON.parse(made.content), {
      zettel: { id: '1', key: 'K', title: 'T' },
    });
    const failed = await run(tools, 'zettel_get', { id: '9' });
    assert.equal(failed.isError, true);
    assert.equal(failed.content, 'Zotero: no zettel 9.');
    assert.deepEqual(
      zotero.map((z) => z.name),
      ['zettel_create', 'zettel_get']
    );
  });

  test('an unknown tool or arguments that weren’t JSON: an error result, not a crash', async () => {
    const { tools } = await make();
    assert.match((await run(tools, 'rm_rf')).content, /Unknown tool/);
    const bad = await run(tools, 'comment_add', {
      _invalidArguments: '{"quote":',
    });
    assert.equal(bad.isError, true);
    assert.match(bad.content, /not valid JSON/);
  });
});
