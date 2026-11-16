import { test } from 'node:test';
import assert from 'node:assert';
import { runTool, ToolError, TOOLS, toolsFor } from './tools.ts';
import { fakePort, ODUM, IPCC } from './fake-port.ts';
import { zettelHtml } from './zettel-note.ts';
import type { PortNote } from './port.ts';

const note = (
  key: string,
  id: string,
  title: string,
  body = '',
  related: string[] = [],
  tags: string[] = []
): PortNote => ({ key, html: zettelHtml(id, title, body), tags, related });

/** 1, 1a, 1a1, 1b, 2 and one note that isn't a zettel. */
function kasten() {
  return fakePort(
    [ODUM, IPCC],
    [
      note('K1000001', '1', 'Energy is the currency of systems'),
      note(
        'K1000002',
        '1a',
        'Emergy counts the energy it took',
        'Odum’s emergy: solar equivalents.',
        ['ABCD2345', 'K1000004']
      ),
      note('K1000003', '1a1', 'Transformity ranks energy quality'),
      note('K1000004', '1b', 'Maximum power selects systems', '', ['K1000002']),
      note('K1000005', '2', 'Growth has limits'),
      { key: 'K1000006', html: '<p>Shopping list</p>', tags: [], related: [] },
    ],
    [{ key: 'OTHER001', html: '<p>Elsewhere</p>', tags: [], related: [] }]
  );
}

const run = (port: ReturnType<typeof kasten>, name: string, args = {}) =>
  runTool(port, name, args) as Promise<Record<string, unknown>>;

test('read tools for read; write tools only with write-notes', () => {
  const read = toolsFor(['read']).map((t) => t.name);
  assert.deepStrictEqual(read, [
    'search_items',
    'get_item',
    'zettel_list',
    'zettel_get',
    'zettel_search',
  ]);
  const write = toolsFor(['write-notes']).map((t) => t.name);
  assert.deepStrictEqual(write, [
    'zettel_create',
    'zettel_update',
    'zettel_link',
    'zettel_unlink',
    'zettel_tag',
  ]);
  for (const t of TOOLS)
    assert.strictEqual(t.annotations.readOnlyHint, t.scope === 'read', t.name);
});

test('zettel_list: Luhmann order, a branch by prefix; other notes left out', async () => {
  const all = (await run(kasten(), 'zettel_list')) as {
    zettels: { id: string; title: string; key: string }[];
  };
  assert.deepStrictEqual(
    all.zettels.map((z) => z.id),
    ['1', '1a', '1a1', '1b', '2']
  );
  assert.deepStrictEqual(all.zettels[1], {
    id: '1a',
    title: 'Emergy counts the energy it took',
    key: 'K1000002',
    tags: [],
  });
  const branch = (await run(kasten(), 'zettel_list', { prefix: '1a' })) as {
    zettels: { id: string }[];
  };
  assert.deepStrictEqual(
    branch.zettels.map((z) => z.id),
    ['1a', '1a1']
  );
  await assert.rejects(
    run(kasten(), 'zettel_list', { prefix: 'A1' }),
    /not a Luhmann ID/
  );
});

test('zettel_get: body, links, sources, parent, children and neighbours', async () => {
  const { zettel } = (await run(kasten(), 'zettel_get', { id: '1a' })) as {
    zettel: Record<string, unknown>;
  };
  assert.deepStrictEqual(zettel, {
    id: '1a',
    title: 'Emergy counts the energy it took',
    body: 'Odum’s emergy: solar equivalents.',
    key: 'K1000002',
    tags: [],
    uri: 'zotero://select/library/items/K1000002',
    links: [{ id: '1b', title: 'Maximum power selects systems' }],
    sources: [
      {
        key: 'ABCD2345',
        title:
          'Environmental Accounting: Emergy and Environmental Decision Making',
        citationKey: 'odum_environmental_1996',
      },
    ],
    parent: { id: '1', title: 'Energy is the currency of systems' },
    children: [{ id: '1a1', title: 'Transformity ranks energy quality' }],
    previous: { id: '1', title: 'Energy is the currency of systems' },
    next: { id: '1a1', title: 'Transformity ranks energy quality' },
  });
  await assert.rejects(run(kasten(), 'zettel_get', { id: '9' }), /No zettel 9/);
});

test('zettel_search: every word, in titles and bodies', async () => {
  const r = (await run(kasten(), 'zettel_search', {
    query: 'SOLAR emergy',
  })) as { zettels: { id: string }[] };
  assert.deepStrictEqual(
    r.zettels.map((z) => z.id),
    ['1a']
  );
  const energy = (await run(kasten(), 'zettel_search', {
    query: 'energy',
  })) as { zettels: { id: string }[] };
  assert.deepStrictEqual(
    energy.zettels.map((z) => z.id),
    ['1', '1a', '1a1']
  );
});

test('zettel_create: a new top-level ID, tagged zk/inbox, linked to sources and zettels', async () => {
  const port = kasten();
  const r = (await run(port, 'zettel_create', {
    title: 'Cities are energy hierarchies',
    body: 'Claim.\n\nEvidence.',
    sources: ['ABCD2345'],
    links: ['1a1'],
  })) as { zettel: { id: string; key: string; title: string } };
  assert.deepStrictEqual(r.zettel, {
    id: '3',
    key: 'NOTE0001',
    title: 'Cities are energy hierarchies',
  });
  const made = port.notes.find((n) => n.key === 'NOTE0001')!;
  assert.strictEqual(
    made.html,
    zettelHtml('3', 'Cities are energy hierarchies', 'Claim.\n\nEvidence.')
  );
  assert.deepStrictEqual(made.tags, ['zk/inbox']);
  assert.ok(port.calls.includes('relate NOTE0001 ABCD2345'));
  assert.ok(port.calls.includes('relate NOTE0001 K1000003'));
});

test('zettel_create: after an ID continues it, under an ID branches from it', async () => {
  const after2 = (await run(kasten(), 'zettel_create', {
    title: 'T',
    after: '2',
  })) as { zettel: { id: string } };
  assert.strictEqual(after2.zettel.id, '3');
  // 1b is taken, so continuing 1a becomes a branch under it.
  const after1a = (await run(kasten(), 'zettel_create', {
    title: 'T',
    after: '1a',
  })) as { zettel: { id: string } };
  assert.strictEqual(after1a.zettel.id, '1a2');
  const under1 = (await run(kasten(), 'zettel_create', {
    title: 'T',
    under: '1',
  })) as { zettel: { id: string } };
  assert.strictEqual(under1.zettel.id, '1c');
});

test('zettel_create: refuses what it can’t do, before writing anything', async () => {
  const port = kasten();
  for (const [args, message] of [
    [{ title: 'T', after: '1', under: '1' }, /either after or under/],
    [{ title: 'T', after: '9' }, /No zettel 9/],
    [{ title: 'T', sources: ['ZZZZ9999'] }, /No item ZZZZ9999/],
    [{ title: 'T', links: ['8'] }, /No zettel 8/],
    [{ title: '   ' }, /needs a title/],
  ] as const) {
    await assert.rejects(run(port, 'zettel_create', args), message);
  }
  assert.ok(!port.calls.some((c) => c.startsWith('create')));
});

test('zettel_create: two at once get different IDs', async () => {
  const port = kasten();
  const [a, b] = (await Promise.all([
    run(port, 'zettel_create', { title: 'A' }),
    run(port, 'zettel_create', { title: 'B' }),
  ])) as { zettel: { id: string } }[];
  assert.deepStrictEqual([a.zettel.id, b.zettel.id].sort(), ['3', '4']);
});

test('zettel_update: a new title keeps the body and its formatting; a new body rewrites it', async () => {
  const port = kasten();
  port.notes[1].html =
    '<div><h1>1a Emergy counts the energy it took</h1><p><b>Rich</b> body.</p></div>';
  await run(port, 'zettel_update', { id: '1a', title: 'Emergy is memory' });
  assert.strictEqual(
    port.notes[1].html,
    '<div><h1>1a Emergy is memory</h1><p><b>Rich</b> body.</p></div>'
  );
  await run(port, 'zettel_update', { id: '1a', body: 'Plain now.' });
  assert.strictEqual(
    port.notes[1].html,
    zettelHtml('1a', 'Emergy is memory', 'Plain now.')
  );
  await assert.rejects(
    run(port, 'zettel_update', { id: '1a' }),
    /a title or a body/
  );
});

test('zettel_link and zettel_unlink: to a zettel or to a source item', async () => {
  const port = kasten();
  await run(port, 'zettel_link', { id: '2', zettel: '1' });
  await run(port, 'zettel_link', { id: '2', item: 'WXYZ6789' });
  assert.ok(port.calls.includes('relate K1000005 K1000001'));
  assert.ok(port.calls.includes('relate K1000005 WXYZ6789'));
  await run(port, 'zettel_unlink', { id: '1a', zettel: '1b' });
  assert.ok(port.calls.includes('unrelate K1000002 K1000004'));
  await assert.rejects(
    run(port, 'zettel_link', { id: '2' }),
    /either a zettel or an item/
  );
  await assert.rejects(
    run(port, 'zettel_link', { id: '2', zettel: '1', item: 'WXYZ6789' }),
    /either a zettel or an item/
  );
  await assert.rejects(
    run(port, 'zettel_link', { id: '2', zettel: '2' }),
    /itself/
  );
});

test('zettel_tag: add and remove; accepting a note means removing zk/inbox', async () => {
  const port = kasten();
  port.notes[0].tags = ['zk/inbox'];
  const r = (await run(port, 'zettel_tag', {
    id: '1',
    add: ['energy'],
    remove: ['zk/inbox'],
  })) as { zettel: { tags: string[] } };
  assert.deepStrictEqual(r.zettel.tags, ['energy']);
  await assert.rejects(run(port, 'zettel_tag', { id: '1' }), ToolError);
});
