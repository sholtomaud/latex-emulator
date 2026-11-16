import { test } from 'node:test';
import assert from 'node:assert';
import { TOOLS, toolsFor, runTool, ToolError } from './tools.ts';
import { fakePort, ODUM, IPCC } from './fake-port.ts';

const port = () => fakePort([ODUM, IPCC]);

test('phase 1 has the two read tools, published with schemas and read-only hints', () => {
  assert.deepStrictEqual(
    TOOLS.map((t) => t.name),
    ['search_items', 'get_item']
  );
  for (const tool of TOOLS) {
    assert.strictEqual(tool.scope, 'read');
    assert.strictEqual(tool.annotations.readOnlyHint, true);
    assert.strictEqual(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 20);
  }
});

test('a client sees only the tools its scopes allow', () => {
  assert.strictEqual(toolsFor(['read']).length, 2);
  assert.strictEqual(toolsFor(['write-notes']).length, 0);
});

test('search_items: summaries with keys, creators, year, citation key and a zotero link', async () => {
  const result = await runTool(port(), 'search_items', { query: 'odum' });
  assert.deepStrictEqual(result, {
    items: [
      {
        key: 'ABCD2345',
        itemType: 'book',
        title:
          'Environmental Accounting: Emergy and Environmental Decision Making',
        creators: ['Odum, Howard T.'],
        year: '1996',
        // No Better BibTeX key: ours, in its author_topic_year form (ADR 0008).
        citationKey: 'odum_environmental_1996',
        uri: 'zotero://select/library/items/ABCD2345',
      },
    ],
  });
});

test('search_items: Better BibTeX’s key wins; institutions and loose dates are handled', async () => {
  const result = (await runTool(port(), 'search_items', {
    query: 'climate',
  })) as { items: { creators: string[]; year: string; citationKey: string }[] };
  assert.deepStrictEqual(result.items[0].creators, ['IPCC']);
  assert.strictEqual(result.items[0].year, '2021');
  assert.strictEqual(result.items[0].citationKey, 'ipcc2021');
});

test('search_items: the limit defaults to 20 and is passed to Zotero', async () => {
  const p = port();
  await runTool(p, 'search_items', { query: 'x' });
  await runTool(p, 'search_items', { query: 'x', limit: 5 });
  assert.deepStrictEqual(p.calls, ['search x 20', 'search x 5']);
});

test('get_item: fields, tags, attachments and BibTeX', async () => {
  const result = (await runTool(port(), 'get_item', {
    key: 'ABCD2345',
  })) as { item: Record<string, unknown> };
  assert.strictEqual(result.item.citationKey, 'odum_environmental_1996');
  assert.deepStrictEqual(result.item.tags, ['emergy']);
  assert.strictEqual(
    (result.item.fields as Record<string, string>).publisher,
    'Wiley'
  );
  assert.deepStrictEqual(result.item.attachments, ODUM.attachments);
  assert.strictEqual(result.item.bibtex, '@book{ABCD2345,\n}\n');
});

test('get_item: an unknown key is a tool error the caller can read', async () => {
  await assert.rejects(
    runTool(port(), 'get_item', { key: 'ZZZZ9999' }),
    (e: unknown) =>
      e instanceof ToolError && e.message === 'No item with key ZZZZ9999.'
  );
});

test('bad arguments are tool errors listing every problem', async () => {
  await assert.rejects(
    runTool(port(), 'get_item', { key: 'lower', extra: 1 }),
    (e: unknown) =>
      e instanceof ToolError &&
      e.message ===
        'Invalid arguments: key is not in the expected form; extra is not a known argument.'
  );
});

test('an unknown tool is reported', async () => {
  await assert.rejects(
    runTool(port(), 'drop_tables', {}),
    (e: unknown) => e instanceof ToolError && /Unknown tool/.test(e.message)
  );
});

test('an item with no title, date or creators still summarises', async () => {
  const bare = {
    ...ODUM,
    key: 'BARE2345',
    fields: {},
    creators: [{ creatorType: 'author', firstName: 'Ada' }],
  };
  const result = (await runTool(fakePort([bare]), 'get_item', {
    key: 'BARE2345',
  })) as { item: { title: string; year: string; creators: string[] } };
  assert.strictEqual(result.item.title, '');
  assert.strictEqual(result.item.year, '');
  assert.deepStrictEqual(result.item.creators, ['Ada']);
});

test('search_items: include_csl adds each item’s CSL-JSON, for the app to make .bib entries', async () => {
  const plain = (await runTool(port(), 'search_items', { query: 'odum' })) as {
    items: Record<string, unknown>[];
  };
  assert.strictEqual('csl' in plain.items[0], false);
  const withCsl = (await runTool(port(), 'search_items', {
    query: 'odum',
    include_csl: true,
  })) as { items: { csl: Record<string, unknown> }[] };
  assert.deepStrictEqual(withCsl.items[0].csl, ODUM.csl);
  await assert.rejects(
    runTool(port(), 'search_items', { query: 'odum', include_csl: 'yes' }),
    ToolError
  );
});
