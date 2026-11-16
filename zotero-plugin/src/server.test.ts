import { test } from 'node:test';
import assert from 'node:assert';
import { createServer } from './server.ts';
import type { Client, HttpRequest, ServerDeps } from './server.ts';
import { fakePort, ODUM } from './fake-port.ts';
import { MCP_PATH, PAIR_METHOD, RPC, TOKEN_META_KEY } from './protocol.ts';

const APP = 'https://sholtomaud.github.io';
const AGENT: Client = {
  id: 'agent',
  name: 'Claude Code',
  origin: null,
  token: 'agent-token-0123456789',
  scopes: ['read'],
  createdAt: 1,
};
const APP_CLIENT: Client = {
  id: 'app',
  name: 'LaTeX Emulator',
  origin: APP,
  token: 'app-token-0123456789',
  scopes: ['read'],
  createdAt: 2,
};

function setup(over: Partial<ServerDeps> = {}) {
  const clients: Client[] = [AGENT, APP_CLIENT];
  const asked: unknown[] = [];
  const deps: ServerDeps = {
    port: fakePort([ODUM]),
    clients: { list: () => clients, add: (c) => clients.push(c) },
    allowedOrigins: () => [APP],
    confirmPairing: async (r) => {
      asked.push(r);
      return true;
    },
    randomToken: () => 'new-token-0123456789',
    now: () => 1000,
    info: { pluginVersion: '0.1.0', zoteroVersion: '10.0.8' },
    ...over,
  };
  return { server: createServer(deps), clients, asked };
}

/** An outside agent: standard MCP, bearer token, no Origin. */
const agent = (body: unknown, headers: Record<string, string> = {}) =>
  ({
    method: 'POST',
    headers: {
      host: '127.0.0.1:23119',
      'content-type': 'application/json',
      authorization: `Bearer ${AGENT.token}`,
      ...headers,
    },
    body,
  }) satisfies HttpRequest;

/** The app: a simple request, text/plain, the token in params._meta. */
const app = (
  method: string,
  params: Record<string, unknown> = {},
  token: string | null = APP_CLIENT.token,
  origin = APP
): HttpRequest => ({
  method: 'POST',
  headers: {
    host: 'localhost:23119',
    origin,
    'content-type': 'text/plain;charset=UTF-8',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    method,
    params: token ? { ...params, _meta: { [TOKEN_META_KEY]: token } } : params,
  }),
});

const rpc = (method: string, params?: unknown, id: number | null = 1) => ({
  jsonrpc: '2.0',
  ...(id === null ? {} : { id }),
  method,
  ...(params === undefined ? {} : { params }),
});

const json = (body: string) => JSON.parse(body);

test('the endpoint path is fixed', () => {
  assert.strictEqual(MCP_PATH, '/latex-emulator/mcp');
});

test('initialize: our server info, tools capability, and the client’s protocol version if we speak it', async () => {
  const { server } = setup();
  const res = await server.handle(
    agent(
      rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    )
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Content-Type'], 'application/json');
  const { result } = json(res.body);
  assert.strictEqual(result.protocolVersion, '2025-06-18');
  assert.deepStrictEqual(result.capabilities, {
    tools: { listChanged: false },
  });
  assert.strictEqual(result.serverInfo.name, 'latex-emulator-zotero');
  assert.strictEqual(result.serverInfo.version, '0.1.0');
  assert.match(result.instructions, /Zotero 10\.0\.8/);
  // For the app's status line, without parsing prose.
  assert.deepStrictEqual(result._meta, {
    'latex-emulator/zotero-version': '10.0.8',
  });

  const other = await server.handle(
    agent(rpc('initialize', { protocolVersion: '1999-01-01' }))
  );
  assert.strictEqual(json(other.body).result.protocolVersion, '2025-11-25');
});

test('notifications are accepted with 202 and no body; ping answers', async () => {
  const { server } = setup();
  const n = await server.handle(
    agent(rpc('notifications/initialized', undefined, null))
  );
  assert.strictEqual(n.status, 202);
  assert.strictEqual(n.body, '');
  const p = await server.handle(agent(rpc('ping')));
  assert.deepStrictEqual(json(p.body), { jsonrpc: '2.0', id: 1, result: {} });
});

test('tools/list shows the tools the token’s scopes allow, with schemas', async () => {
  const { server } = setup();
  const res = await server.handle(agent(rpc('tools/list')));
  const { tools } = json(res.body).result;
  assert.deepStrictEqual(
    tools.map((t: { name: string }) => t.name),
    ['search_items', 'get_item']
  );
  assert.strictEqual(tools[0].inputSchema.type, 'object');
  assert.deepStrictEqual(tools[0].annotations, { readOnlyHint: true });
  assert.strictEqual(tools[0].scope, undefined); // internal, not published
});

test('tools/call returns the result as structured content and as text', async () => {
  const { server } = setup();
  const res = await server.handle(
    agent(
      rpc('tools/call', { name: 'search_items', arguments: { query: 'odum' } })
    )
  );
  const { result } = json(res.body);
  assert.strictEqual(result.isError, undefined);
  assert.strictEqual(result.structuredContent.items[0].key, 'ABCD2345');
  assert.deepStrictEqual(
    JSON.parse(result.content[0].text),
    result.structuredContent
  );
});

test('tool failures come back as isError results the model can read', async () => {
  const { server } = setup();
  const res = await server.handle(
    agent(
      rpc('tools/call', { name: 'get_item', arguments: { key: 'ZZZZ9999' } })
    )
  );
  const { result } = json(res.body);
  assert.strictEqual(result.isError, true);
  assert.strictEqual(result.content[0].text, 'No item with key ZZZZ9999.');

  // Zotero itself failing is reported the same way, not as a crash.
  const broken = setup({
    port: {
      ...fakePort([]),
      search: async () => {
        throw new Error('database is locked');
      },
    },
  });
  const r2 = json(
    (
      await broken.server.handle(
        agent(
          rpc('tools/call', { name: 'search_items', arguments: { query: 'x' } })
        )
      )
    ).body
  ).result;
  assert.strictEqual(r2.isError, true);
  assert.strictEqual(
    r2.content[0].text,
    'Zotero could not do that: database is locked'
  );
});

test('a tool outside the token’s scopes, or unknown, is refused', async () => {
  const { server, clients } = setup();
  clients.push({
    ...AGENT,
    id: 'w',
    token: 'writer-token-0123456',
    scopes: ['write-notes'],
  });
  const res = await server.handle(
    agent(
      rpc('tools/call', { name: 'search_items', arguments: { query: 'x' } }),
      {
        authorization: 'Bearer writer-token-0123456',
      }
    )
  );
  assert.strictEqual(json(res.body).error.code, RPC.forbidden);
  const unknown = await server.handle(
    agent(rpc('tools/call', { name: 'rm_rf', arguments: {} }))
  );
  assert.strictEqual(json(unknown.body).error.code, RPC.invalidParams);
});

test('the app: a simple text/plain request with its token in _meta, answered with CORS for its origin', async () => {
  const { server } = setup();
  const res = await server.handle(
    app('tools/call', { name: 'search_items', arguments: { query: 'odum' } })
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Access-Control-Allow-Origin'], APP);
  assert.strictEqual(res.headers.Vary, 'Origin');
  assert.strictEqual(json(res.body).id, 7);
  assert.strictEqual(json(res.body).result.structuredContent.items.length, 1);
  // No CORS headers for clients without an Origin.
  const a = await server.handle(agent(rpc('ping')));
  assert.strictEqual(a.headers['Access-Control-Allow-Origin'], undefined);
});

test('a request for another Host is refused (DNS rebinding)', async () => {
  const { server } = setup();
  const res = await server.handle(
    agent(rpc('ping'), { host: 'evil.example:23119' })
  );
  assert.strictEqual(res.status, 403);
  const missing = await server.handle({ ...agent(rpc('ping')), headers: {} });
  assert.strictEqual(missing.status, 403);
});

test('a web page from another origin is refused, without CORS headers', async () => {
  const { server } = setup();
  const res = await server.handle(
    app('ping', {}, APP_CLIENT.token, 'https://evil.example')
  );
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.headers['Access-Control-Allow-Origin'], undefined);
  // Even pairing: an unknown site can't put a dialog in front of the user.
  const pair = await server.handle(
    app(
      PAIR_METHOD,
      { name: 'x', code: '1234', scopes: ['read'] },
      null,
      'https://evil.example'
    )
  );
  assert.strictEqual(pair.status, 403);
});

test('no token, or a wrong one, is 401', async () => {
  const { server } = setup();
  for (const req of [
    app('ping', {}, null),
    app('ping', {}, 'app-token-0123456780'),
    agent(rpc('ping'), { authorization: '' }),
    agent(rpc('ping'), { authorization: 'Basic abc' }),
  ]) {
    const res = await server.handle(req);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(json(res.body).error.code, RPC.unauthorized);
  }
});

test('a token only works from the origin it was paired from', async () => {
  const { server } = setup();
  // The agent's token (paired with no origin) used from a web page.
  const res = await server.handle(app('ping', {}, AGENT.token));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(json(res.body).error.code, RPC.forbidden);
});

test('GET and DELETE get 405: there is no SSE stream and no session', async () => {
  const { server } = setup();
  for (const method of ['GET', 'DELETE']) {
    const res = await server.handle({ ...agent(undefined), method });
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.headers.Allow, 'POST');
  }
});

test('malformed messages get JSON-RPC errors', async () => {
  const { server } = setup();
  const parse = await server.handle({ ...app('ping'), body: '{nope' });
  assert.strictEqual(parse.status, 400);
  assert.strictEqual(json(parse.body).error.code, RPC.parseError);
  for (const body of [
    [rpc('ping')],
    { jsonrpc: '1.0', id: 1, method: 'ping' },
    'null',
    { id: 1 },
    { jsonrpc: '2.0', id: 1 },
    { jsonrpc: '2.0', id: 1, method: 5 },
    { jsonrpc: '2.0', id: 1, method: 'ping', params: [1] },
  ]) {
    const res = await server.handle(agent(body));
    assert.strictEqual(res.status, 400, JSON.stringify(body));
    assert.strictEqual(json(res.body).error.code, RPC.invalidRequest);
  }
  const unknown = await server.handle(agent(rpc('resources/list')));
  assert.strictEqual(json(unknown.body).error.code, RPC.methodNotFound);
  // A response sent to us (no method) is accepted and ignored.
  const reply = await server.handle(
    agent({ jsonrpc: '2.0', id: 3, result: {} })
  );
  assert.strictEqual(reply.status, 202);
});

test('an unsupported MCP-Protocol-Version header is 400', async () => {
  const { server } = setup();
  const res = await server.handle(
    agent(rpc('ping'), { 'mcp-protocol-version': '1999-01-01' })
  );
  assert.strictEqual(res.status, 400);
  const ok = await server.handle(
    agent(rpc('ping'), { 'mcp-protocol-version': '2025-06-18' })
  );
  assert.strictEqual(ok.status, 200);
});

test('pairing: the user is asked, with the origin, name, code and scopes; a token comes back', async () => {
  const { server, clients, asked } = setup();
  const res = await server.handle(
    app(
      PAIR_METHOD,
      { name: 'LaTeX Emulator', code: '4719', scopes: ['read'] },
      null
    )
  );
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(json(res.body).result, {
    token: 'new-token-0123456789',
    scopes: ['read'],
  });
  assert.deepStrictEqual(asked, [
    { name: 'LaTeX Emulator', code: '4719', scopes: ['read'], origin: APP },
  ]);
  assert.deepStrictEqual(clients.at(-1), {
    id: 'client-1000',
    name: 'LaTeX Emulator',
    origin: APP,
    token: 'new-token-0123456789',
    scopes: ['read'],
    createdAt: 1000,
  });
  // The new token works at once.
  const ping = await server.handle(app('ping', {}, 'new-token-0123456789'));
  assert.strictEqual(ping.status, 200);
});

test('pairing: a refusal, or a dialog that fails, is an error and stores nothing', async () => {
  for (const confirm of [
    async () => false,
    async () => {
      throw new Error('timed out');
    },
  ]) {
    const { server, clients } = setup({ confirmPairing: confirm });
    const res = await server.handle(
      app(PAIR_METHOD, { name: 'App', code: '1234', scopes: ['read'] }, null)
    );
    assert.strictEqual(json(res.body).error.code, RPC.pairingRefused);
    assert.strictEqual(clients.length, 2);
  }
});

test('pairing: one request at a time', async () => {
  let release: (ok: boolean) => void = () => {};
  const { server } = setup({
    confirmPairing: () => new Promise<boolean>((r) => (release = r)),
  });
  const first = server.handle(
    app(PAIR_METHOD, { name: 'A', code: '1111', scopes: ['read'] }, null)
  );
  const second = await server.handle(
    app(PAIR_METHOD, { name: 'B', code: '2222', scopes: ['read'] }, null)
  );
  assert.strictEqual(json(second.body).error.code, RPC.pairingBusy);
  release(true);
  assert.ok(json((await first).body).result.token);
  // Once answered, another may ask.
  const third = server.handle(
    app(PAIR_METHOD, { name: 'C', code: '3333', scopes: ['read'] }, null)
  );
  release(true);
  assert.ok(json((await third).body).result.token);
});

test('pairing: bad parameters are refused before anyone is asked', async () => {
  const { server, asked } = setup();
  for (const params of [
    { name: '', code: '1234', scopes: ['read'] },
    { name: 'A', code: '12a4', scopes: ['read'] },
    { name: 'A', code: '1234', scopes: [] },
    { name: 'A', code: '1234', scopes: ['admin'] },
    { name: 'x'.repeat(61), code: '1234', scopes: ['read'] },
  ]) {
    const res = await server.handle(app(PAIR_METHOD, params, null));
    assert.strictEqual(
      json(res.body).error.code,
      RPC.invalidParams,
      JSON.stringify(params)
    );
  }
  assert.strictEqual(asked.length, 0);
});
