/**
 * The plugin in a real Zotero (ADR 0024 §7): build the .xpi, install it
 * into a throwaway profile with its own data directory, start Zotero
 * headless, and drive the MCP endpoint over HTTP.
 *
 *   ZOTERO_DIR=/path/to/Zotero_linux-x86_64 npm run test:zotero
 *
 * Needs Xvfb (xvfb-run) on Linux, and nothing else on port 23119: quit
 * your own Zotero first. Your library is never touched: the profile and
 * data directory are created in a temporary folder and deleted after.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { MCP_PATH, TOKEN_META_KEY, ZOTERO_PORT } from '../src/protocol.ts';

const ZOTERO_DIR = process.env.ZOTERO_DIR;
const root = path.resolve(import.meta.dirname, '../..');
const meta = JSON.parse(
  fs.readFileSync(path.join(root, 'zotero-plugin/plugin.json'), 'utf8')
);
const APP = new URL(meta.site).origin;
const AGENT_TOKEN = 'integration-agent-token-0123456789abcdef';
const APP_TOKEN = 'integration-app-token-0123456789abcdefgh';
const WRITER_TOKEN = 'integration-writer-token-0123456789abcd';

let zotero: ChildProcess | undefined;
let tmp = '';
let log = '';

interface Reply {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** node:http, so tests can set Host and Origin as a browser or attacker would. */
function request(
  pathname: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
) {
  return new Promise<Reply>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: ZOTERO_PORT,
        path: pathname,
        method: init.method ?? 'POST',
        headers: {
          host: `127.0.0.1:${ZOTERO_PORT}`,
          // Zotero's server refuses a POST without a length (no chunking).
          ...(init.body
            ? { 'content-length': String(Buffer.byteLength(init.body)) }
            : {}),
          ...init.headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: res.headers,
            body,
          })
        );
      }
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

let nextId = 1;
const rpcBody = (method: string, params?: Record<string, unknown>) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: nextId++,
    method,
    ...(params ? { params } : {}),
  });

/** An outside agent: standard MCP with a bearer token. */
const agent = (method: string, params?: Record<string, unknown>) =>
  request(MCP_PATH, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${AGENT_TOKEN}`,
    },
    body: rpcBody(method, params),
  });

const callTool = async (
  name: string,
  args: Record<string, unknown>,
  token = AGENT_TOKEN
) => {
  const res = await request(MCP_PATH, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: rpcBody('tools/call', { name, arguments: args }),
  });
  assert.strictEqual(res.status, 200, res.body);
  const body = JSON.parse(res.body);
  return body.result ?? body;
};
const write = (name: string, args: Record<string, unknown>) =>
  callTool(name, args, WRITER_TOKEN);

async function waitFor(
  what: string,
  check: () => Promise<boolean>,
  seconds = 90
) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Timed out waiting for ${what}.\n--- Zotero log (tail) ---\n${log.slice(-4000)}`
  );
}

before(async () => {
  assert.ok(ZOTERO_DIR, 'Set ZOTERO_DIR to an unpacked Zotero for Linux.');
  const busy = await request('/connector/ping', { method: 'GET' }).then(
    () => true,
    () => false
  );
  assert.ok(
    !busy,
    `Something already answers on port ${ZOTERO_PORT}: quit Zotero first.`
  );

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zotero-it-'));
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts/build-zotero-plugin.ts'), tmp],
    { stdio: 'inherit' }
  );
  const profile = path.join(tmp, 'profile');
  const data = path.join(tmp, 'data');
  fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
  fs.mkdirSync(data);
  // Sideloaded: Firefox installs an .xpi named after the add-on's ID.
  fs.copyFileSync(
    path.join(tmp, 'zotero/latex-emulator-zotero.xpi'),
    path.join(profile, 'extensions', `${meta.id}.xpi`)
  );
  const clients = [
    {
      id: 'agent',
      name: 'Integration agent',
      origin: null,
      token: AGENT_TOKEN,
      scopes: ['read'],
      createdAt: 1,
    },
    {
      id: 'writer',
      name: 'Integration writer',
      origin: null,
      token: WRITER_TOKEN,
      scopes: ['read', 'write-notes'],
      createdAt: 3,
    },
    {
      id: 'app',
      name: 'LaTeX Emulator',
      origin: APP,
      token: APP_TOKEN,
      scopes: ['read'],
      createdAt: 2,
    },
  ];
  const prefs: Record<string, string | number | boolean> = {
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'extensions.update.enabled': false,
    'app.update.enabled': false,
    'extensions.zotero.dataDir': data,
    'extensions.zotero.useDataDir': true,
    'extensions.zotero.firstRunGuidance': false,
    'extensions.zotero.sync.autoSync': false,
    'extensions.zotero.automaticScraperUpdates': false,
    'extensions.latex-emulator.clients': JSON.stringify(clients),
  };
  fs.writeFileSync(
    path.join(profile, 'user.js'),
    Object.entries(prefs)
      .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join('\n') + '\n'
  );

  const command = [
    path.join(ZOTERO_DIR!, 'zotero'),
    '-profile',
    profile,
    '-ZoteroDebugText',
  ];
  zotero = process.env.DISPLAY
    ? spawn(command[0], command.slice(1), { stdio: 'pipe' })
    : spawn('xvfb-run', ['-a', ...command], { stdio: 'pipe', detached: true });
  zotero.stdout?.on('data', (c) => (log += c));
  zotero.stderr?.on('data', (c) => (log += c));

  await waitFor(
    'Zotero',
    async () =>
      (await request('/connector/ping', { method: 'GET' })).status === 200
  );
  await waitFor('the plugin', async () => (await agent('ping')).status === 200);
  // Zotero's own connector endpoint adds an item, as a browser extension would.
  await waitFor('the library', async () => {
    const res = await request('/connector/saveItems', {
      headers: {
        'content-type': 'application/json',
        'x-zotero-connector-api-version': '3',
      },
      body: JSON.stringify({
        sessionID: `it-${Date.now()}`,
        uri: 'https://example.org/odum',
        items: [
          {
            itemType: 'book',
            title:
              'Environmental Accounting: Emergy and Environmental Decision Making',
            creators: [
              {
                firstName: 'Howard T.',
                lastName: 'Odum',
                creatorType: 'author',
              },
            ],
            date: '1996',
            publisher: 'Wiley',
            tags: ['emergy'],
          },
        ],
      }),
    });
    return res.status === 201;
  });
});

after(() => {
  if (zotero?.pid) {
    try {
      // xvfb-run starts Zotero in its own process group: stop them all.
      process.kill(
        zotero.pid > 0 && !process.env.DISPLAY ? -zotero.pid : zotero.pid,
        'SIGTERM'
      );
    } catch {
      /* already gone */
    }
  }
  // ZOTERO_LOG=<file> keeps Zotero's debug output (CI uploads it).
  if (process.env.ZOTERO_LOG) fs.writeFileSync(process.env.ZOTERO_LOG, log);
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('initialize: the plugin answers as an MCP server, naming this Zotero', async () => {
  const res = await agent('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
  });
  assert.strictEqual(res.status, 200, res.body);
  const { result } = JSON.parse(res.body);
  assert.strictEqual(result.serverInfo.name, 'latex-emulator-zotero');
  assert.strictEqual(result.serverInfo.version, meta.version);
  assert.match(result.instructions, /Zotero \d+\.\d+/);
});

test('tools/list: a read-only token gets the read tools only', async () => {
  const res = await agent('tools/list');
  const names = JSON.parse(res.body).result.tools.map(
    (t: { name: string }) => t.name
  );
  assert.deepStrictEqual(names, [
    'search_items',
    'get_item',
    'zettel_list',
    'zettel_get',
    'zettel_search',
  ]);
});

test('the Zettelkasten in a real Zotero: create, branch, link, read, retitle, accept', async () => {
  // No collection yet: an empty Zettelkasten, not an error.
  const empty = await callTool('zettel_list', {});
  assert.deepStrictEqual(empty.structuredContent, { zettels: [] });
  // A read-only token can't write.
  const refused = await callTool('zettel_create', { title: 'x' });
  assert.match(refused.error.message, /may not use zettel_create/);

  const odum = (await callTool('search_items', { query: 'odum' }))
    .structuredContent.items[0].key;
  const first = await write('zettel_create', {
    title: 'Energy is the currency of systems',
    body: 'Odum’s claim, in my words.\n\nSecond paragraph.',
    sources: [odum],
  });
  assert.strictEqual(first.isError, undefined, JSON.stringify(first));
  assert.strictEqual(first.structuredContent.zettel.id, '1');
  const child = await write('zettel_create', {
    title: 'Emergy counts the energy it took',
    under: '1',
    links: ['1'],
  });
  assert.strictEqual(child.structuredContent.zettel.id, '1a');

  const got = (await callTool('zettel_get', { id: '1' })).structuredContent
    .zettel;
  assert.strictEqual(got.title, 'Energy is the currency of systems');
  assert.strictEqual(
    got.body,
    'Odum’s claim, in my words.\n\nSecond paragraph.'
  );
  assert.deepStrictEqual(got.tags, ['zk/inbox']);
  assert.deepStrictEqual(got.sources, [
    {
      key: odum,
      title:
        'Environmental Accounting: Emergy and Environmental Decision Making',
      citationKey: 'odum_environmental_1996',
    },
  ]);
  // Related works both ways: 1a linked to 1, so 1 shows 1a.
  assert.deepStrictEqual(got.links, [
    { id: '1a', title: 'Emergy counts the energy it took' },
  ]);
  assert.deepStrictEqual(got.children, [
    { id: '1a', title: 'Emergy counts the energy it took' },
  ]);

  const listed = (await callTool('zettel_list', {})).structuredContent.zettels;
  assert.deepStrictEqual(
    listed.map((z: { id: string }) => z.id),
    ['1', '1a']
  );
  const found = (await callTool('zettel_search', { query: 'my words' }))
    .structuredContent.zettels;
  assert.deepStrictEqual(
    found.map((z: { id: string }) => z.id),
    ['1']
  );

  await write('zettel_update', { id: '1a', title: 'Emergy is energy memory' });
  await write('zettel_tag', { id: '1', remove: ['zk/inbox'], add: ['energy'] });
  await write('zettel_unlink', { id: '1a', zettel: '1' });
  const after = (await callTool('zettel_get', { id: '1' })).structuredContent
    .zettel;
  assert.deepStrictEqual(after.tags, ['energy']);
  assert.deepStrictEqual(after.links, []);
  assert.deepStrictEqual(after.children, [
    { id: '1a', title: 'Emergy is energy memory' },
  ]);
});

test('search_items and get_item read the real library', async () => {
  const search = await callTool('search_items', { query: 'odum' });
  assert.strictEqual(search.isError, undefined, JSON.stringify(search));
  const [hit] = search.structuredContent.items;
  assert.strictEqual(
    hit.title,
    'Environmental Accounting: Emergy and Environmental Decision Making'
  );
  assert.deepStrictEqual(hit.creators, ['Odum, Howard T.']);
  assert.strictEqual(hit.year, '1996');
  assert.strictEqual(hit.citationKey, 'odum_environmental_1996');
  assert.match(hit.uri, /^zotero:\/\/select\/library\/items\/[A-Z0-9]{8}$/);

  const got = await callTool('get_item', { key: hit.key });
  assert.strictEqual(got.structuredContent.item.fields.publisher, 'Wiley');
  assert.deepStrictEqual(got.structuredContent.item.tags, ['emergy']);
  assert.match(got.structuredContent.item.bibtex, /@book\{/);

  const none = await callTool('get_item', { key: 'ZZZZ9999' });
  assert.strictEqual(none.isError, true);
});

test('the app’s simple request works, with CORS for its origin only', async () => {
  const res = await request(MCP_PATH, {
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      origin: APP,
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140',
    },
    body: rpcBody('tools/call', {
      name: 'search_items',
      arguments: { query: 'emergy' },
      _meta: { [TOKEN_META_KEY]: APP_TOKEN },
    }),
  });
  assert.strictEqual(res.status, 200, res.body);
  assert.strictEqual(res.headers['access-control-allow-origin'], APP);
  assert.strictEqual(
    JSON.parse(res.body).result.structuredContent.items.length,
    1
  );
});

test('refused: another website, a missing token, another Host', async () => {
  const evil = await request(MCP_PATH, {
    headers: {
      'content-type': 'text/plain',
      origin: 'https://evil.example',
      'user-agent': 'Mozilla/5.0',
    },
    body: rpcBody('ping', { _meta: { [TOKEN_META_KEY]: APP_TOKEN } }),
  });
  assert.strictEqual(evil.status, 403);
  assert.strictEqual(evil.headers['access-control-allow-origin'], undefined);

  const anonymous = await request(MCP_PATH, {
    headers: { 'content-type': 'application/json' },
    body: rpcBody('ping'),
  });
  assert.strictEqual(anonymous.status, 401);
  assert.strictEqual(anonymous.statusText, 'Unauthorized');

  const rebound = await request(MCP_PATH, {
    headers: {
      host: `attacker.example:${ZOTERO_PORT}`,
      'content-type': 'application/json',
      authorization: `Bearer ${AGENT_TOKEN}`,
    },
    body: rpcBody('ping'),
  });
  // Zotero's own server refuses it first, with a 400 (its wording varies
  // by version), before any endpoint runs; our 403 is the second layer
  // (server.test.ts).
  assert.strictEqual(rebound.status, 400);
});

test('GET is 405 (no SSE stream), with the right status text', async () => {
  const res = await request(MCP_PATH, {
    method: 'GET',
    headers: { authorization: `Bearer ${AGENT_TOKEN}` },
  });
  assert.strictEqual(res.status, 405);
  assert.strictEqual(res.statusText, 'Method Not Allowed');
});
