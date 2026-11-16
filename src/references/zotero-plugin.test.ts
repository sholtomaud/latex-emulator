import { test } from 'node:test';
import assert from 'node:assert';
import {
  pairingCode,
  pairWithZotero,
  zoteroPluginInfo,
  pluginStatusText,
  searchViaPlugin,
} from './zotero-plugin.ts';
import type { FetchLike } from './zotero-plugin.ts';

type Json = ReturnType<typeof JSON.parse>;

interface Seen {
  url: string;
  init: RequestInit & { targetAddressSpace?: string };
  body: Json;
}

function fakeFetch(
  respond: (body: Json) => { status: number; json?: unknown } | Error
) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, init, body });
    const r = respond(body);
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => r.json };
  };
  return { fetch, seen };
}

test('pairing codes are four digits', () => {
  assert.strictEqual(pairingCode(7), '0007');
  assert.strictEqual(pairingCode(4719), '4719');
  assert.strictEqual(pairingCode(123_456_789), '6789');
});

test('every request is a CORS "simple request": POST, text/plain, no other headers, to loopback', async () => {
  const { fetch, seen } = fakeFetch(() => ({
    status: 200,
    json: {
      jsonrpc: '2.0',
      id: 1,
      result: { token: 't'.repeat(43), scopes: ['read'] },
    },
  }));
  await pairWithZotero(fetch, '4719');
  const [{ url, init, body }] = seen;
  assert.strictEqual(url, 'http://127.0.0.1:23119/latex-emulator/mcp');
  assert.strictEqual(init.method, 'POST');
  assert.deepStrictEqual(init.headers, { 'Content-Type': 'text/plain' });
  // Chromium's Local Network Access: say we mean to reach this computer.
  assert.strictEqual(init.targetAddressSpace, 'loopback');
  assert.strictEqual(init.credentials, 'omit');
  assert.deepStrictEqual(body, {
    jsonrpc: '2.0',
    id: 1,
    method: 'pair/request',
    params: { name: 'LaTeX Emulator', code: '4719', scopes: ['read'] },
  });
});

test('pairing returns the token, or why not', async () => {
  const token = 't'.repeat(43);
  const ok = fakeFetch(() => ({
    status: 200,
    json: { jsonrpc: '2.0', id: 1, result: { token, scopes: ['read'] } },
  }));
  assert.deepStrictEqual(await pairWithZotero(ok.fetch, '1234'), {
    ok: true,
    token,
  });

  const cases: [Parameters<typeof fakeFetch>[0], string][] = [
    [() => new TypeError('Failed to fetch'), 'unreachable'],
    [
      () => ({
        status: 200,
        json: { jsonrpc: '2.0', id: 1, error: { code: -32004, message: 'no' } },
      }),
      'refused',
    ],
    [
      () => ({
        status: 200,
        json: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32003, message: 'busy' },
        },
      }),
      'busy',
    ],
    [() => ({ status: 403, json: {} }), 'forbidden'],
    [() => ({ status: 404, json: {} }), 'no-plugin'],
    [() => ({ status: 500, json: {} }), 'error'],
    [
      () => ({
        status: 200,
        json: { jsonrpc: '2.0', id: 1, result: { token: 5 } },
      }),
      'error',
    ],
    [() => ({ status: 200, json: 'nonsense' }), 'error'],
    [
      () => ({
        status: 200,
        json: { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'x' } },
      }),
      'error',
    ],
  ];
  for (const [respond, failure] of cases)
    assert.deepStrictEqual(
      (await pairWithZotero(fakeFetch(respond).fetch, '1234')) as unknown,
      { ok: false, failure },
      failure
    );
});

test('info: initialize with the token in _meta; versions come back', async () => {
  const { fetch, seen } = fakeFetch(() => ({
    status: 200,
    json: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: { name: 'latex-emulator-zotero', version: '0.1.0' },
        _meta: { 'latex-emulator/zotero-version': '10.0.8' },
      },
    },
  }));
  assert.deepStrictEqual(await zoteroPluginInfo(fetch, 'TOKEN'), {
    ok: true,
    zoteroVersion: '10.0.8',
    pluginVersion: '0.1.0',
  });
  assert.strictEqual(seen[0].body.method, 'initialize');
  assert.deepStrictEqual(seen[0].body.params._meta, {
    'latex-emulator/token': 'TOKEN',
  });
  assert.ok(seen[0].body.params.protocolVersion);
  assert.deepStrictEqual(seen[0].body.params.clientInfo, {
    name: 'latex-emulator',
    version: '1',
  });
});

test('a reply that is not JSON is an error, not a crash', async () => {
  const fetch: FetchLike = async () => ({
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  });
  assert.deepStrictEqual((await pairWithZotero(fetch, '1234')) as unknown, {
    ok: false,
    failure: 'error',
  });
});

test('info: a removed connection (401) says so', async () => {
  const { fetch } = fakeFetch(() => ({
    status: 401,
    json: { jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'x' } },
  }));
  assert.deepStrictEqual((await zoteroPluginInfo(fetch, 'old')) as unknown, {
    ok: false,
    failure: 'unpaired',
  });
  const odd = fakeFetch(() => ({
    status: 200,
    json: { jsonrpc: '2.0', id: 1, result: {} },
  }));
  assert.deepStrictEqual(await zoteroPluginInfo(odd.fetch, 't'), {
    ok: true,
    zoteroVersion: '',
    pluginVersion: '',
  });
});

test('status lines say what is happening and what to do', () => {
  assert.strictEqual(
    pluginStatusText({
      state: 'connected',
      zoteroVersion: '10.0.8',
      pluginVersion: '0.1.0',
    }),
    'Connected to Zotero 10.0.8 (plugin 0.1.0).'
  );
  assert.strictEqual(
    pluginStatusText({ state: 'checking' }),
    'Looking for Zotero…'
  );
  assert.strictEqual(
    pluginStatusText({ state: 'pairing', code: '4719' }),
    'In Zotero, check that the code is 4 7 1 9, then click Allow.'
  );
  assert.strictEqual(pluginStatusText({ state: 'idle' }), 'Not connected.');
  const failures = {
    unreachable: /Zotero didn’t answer/,
    'no-plugin': /plugin isn’t installed/,
    forbidden: /doesn’t allow this site/,
    refused: /declined in Zotero/,
    busy: /already asking/,
    unpaired: /removed in Zotero/,
    error: /went wrong/,
  } as const;
  for (const [failure, text] of Object.entries(failures))
    assert.match(
      pluginStatusText({
        state: 'failed',
        failure: failure as keyof typeof failures,
      }),
      text
    );
});

const ODUM_CSL = {
  type: 'book',
  title: 'Environmental Accounting',
  author: [{ family: 'Odum', given: 'Howard T.' }],
  issued: { 'date-parts': [[1996]] },
};

test('search: search_items with include_csl and the token; hits from the CSL', async () => {
  const { fetch, seen } = fakeFetch(() => ({
    status: 200,
    json: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: '…' }],
        structuredContent: {
          items: [
            {
              key: 'ABCD2345',
              title: 'Environmental Accounting',
              csl: ODUM_CSL,
            },
          ],
        },
      },
    },
  }));
  const r = await searchViaPlugin(fetch, 'tok', '  odum ');
  assert.deepStrictEqual(seen[0].body.method, 'tools/call');
  assert.deepStrictEqual(seen[0].body.params.name, 'search_items');
  assert.deepStrictEqual(seen[0].body.params.arguments, {
    query: 'odum',
    limit: 25,
    include_csl: true,
  });
  assert.strictEqual(
    seen[0].body.params._meta['latex-emulator/token'] ??
      Object.values(seen[0].body.params._meta)[0],
    'tok'
  );
  assert.deepStrictEqual(r, {
    ok: true,
    hits: [
      {
        title: 'Environmental Accounting',
        creators: 'Odum',
        year: '1996',
        csl: ODUM_CSL,
      },
    ],
  });
});

test('search: an older plugin (no include_csl) says to update it; failures say why', async () => {
  const old = fakeFetch(() => ({
    status: 200,
    json: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          {
            type: 'text',
            text: 'Invalid arguments: include_csl is not a known argument.',
          },
        ],
        isError: true,
      },
    },
  }));
  const r1 = await searchViaPlugin(old.fetch, 'tok', 'odum');
  assert.strictEqual(r1.ok, false);
  assert.match(!r1.ok ? r1.message : '', /Update the LaTeX Emulator plugin/);

  const noCsl = fakeFetch(() => ({
    status: 200,
    json: {
      jsonrpc: '2.0',
      id: 1,
      result: { structuredContent: { items: [{ key: 'X' }] } },
    },
  }));
  const r2 = await searchViaPlugin(noCsl.fetch, 'tok', 'odum');
  assert.match(!r2.ok ? r2.message : '', /Update the LaTeX Emulator plugin/);

  const other = fakeFetch(() => ({
    status: 200,
    json: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: 'Zotero could not do that: busy' }],
        isError: true,
      },
    },
  }));
  const r3 = await searchViaPlugin(other.fetch, 'tok', 'odum');
  assert.deepStrictEqual(r3, {
    ok: false,
    message: 'Zotero could not do that: busy',
  });

  const down = fakeFetch(() => new TypeError('Failed to fetch'));
  const r4 = await searchViaPlugin(down.fetch, 'tok', 'odum');
  assert.match(!r4.ok ? r4.message : '', /^Zotero didn’t answer/);

  const empty = await searchViaPlugin(down.fetch, 'tok', '  ');
  assert.deepStrictEqual(empty, {
    ok: false,
    message: 'Type something to search for.',
  });
});
