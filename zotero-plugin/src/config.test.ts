import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseClients,
  parseOrigins,
  tokenFromBytes,
  pairingPrompt,
  mcpCommand,
  siteOrigin,
} from './config.ts';

const client = {
  id: 'client-1',
  name: 'LaTeX Emulator',
  origin: 'https://sholtomaud.github.io',
  token: 'x'.repeat(43),
  scopes: ['read'],
  createdAt: 5,
};

test('stored clients are read back; anything malformed is dropped, not trusted', () => {
  assert.deepStrictEqual(parseClients(JSON.stringify([client])), [client]);
  assert.deepStrictEqual(
    parseClients(
      JSON.stringify([
        client,
        { ...client, token: 'short' },
        { ...client, scopes: ['root'] },
        { ...client, origin: 7 },
        { ...client, name: '' },
        'nope',
      ])
    ),
    [client]
  );
  assert.deepStrictEqual(parseClients(undefined), []);
  assert.deepStrictEqual(parseClients('{broken'), []);
  assert.deepStrictEqual(parseClients('{}'), []);
  assert.deepStrictEqual(
    parseClients(JSON.stringify([{ ...client, origin: null }]))[0].origin,
    null
  );
});

test('allowed sites: the app’s own origin, plus valid origins the user added', () => {
  const site = 'https://sholtomaud.github.io/latex-emulator/';
  assert.strictEqual(siteOrigin(site), 'https://sholtomaud.github.io');
  assert.deepStrictEqual(parseOrigins(undefined, site), [
    'https://sholtomaud.github.io',
  ]);
  assert.deepStrictEqual(
    parseOrigins(
      'http://localhost:5173\n  https://example.org  \nnot a url\nhttps://example.org/path\nftp://x.y\nhttps://sholtomaud.github.io\n',
      site
    ),
    [
      'https://sholtomaud.github.io',
      'http://localhost:5173',
      'https://example.org',
    ]
  );
});

test('tokens are 32 random bytes as base64url', () => {
  const bytes = new Uint8Array(32).map((_, i) => i * 7);
  const token = tokenFromBytes(bytes);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(
    Buffer.from(token, 'base64url').toString('hex'),
    Buffer.from(bytes).toString('hex')
  );
  assert.throws(() => tokenFromBytes(new Uint8Array(8)), /32 bytes/);
});

test('the pairing dialog says who asks, from where, for what, and the code', () => {
  assert.strictEqual(
    pairingPrompt({
      name: 'LaTeX Emulator',
      origin: 'https://sholtomaud.github.io',
      code: '4719',
      scopes: ['read'],
    }),
    [
      '“LaTeX Emulator” at https://sholtomaud.github.io wants to connect to Zotero.',
      '',
      'It will be able to: search and read your library.',
      '',
      'Check that it shows this code: 4 7 1 9',
      '',
      'Allow it only if you just clicked Connect there.',
    ].join('\n')
  );
  assert.match(
    pairingPrompt({
      name: 'Agent',
      origin: null,
      code: '1234',
      scopes: ['read', 'write-notes'],
    }),
    /^“Agent”, a program on this computer, wants.*\n\nIt will be able to: search and read your library; create and change notes\./s
  );
  assert.match(
    pairingPrompt({
      name: 'A',
      origin: null,
      code: '1234',
      scopes: ['write-items'],
    }),
    /create and change items and collections/
  );
});

test('the MCP command to paste into Claude Code', () => {
  assert.strictEqual(
    mcpCommand('TOKEN'),
    'claude mcp add --transport http zotero http://127.0.0.1:23119/latex-emulator/mcp --header "Authorization: Bearer TOKEN"'
  );
});
