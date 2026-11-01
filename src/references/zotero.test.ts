import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  parseZoteroItems,
  searchZotero,
  zoteroSearchRequest,
} from './zotero.ts';

const LOCAL = { kind: 'local' } as const;
const WEB = { kind: 'web', userId: '123456', apiKey: 'k3y' } as const;

const ITEMS = [
  {
    id: '123456/ABCD1234',
    type: 'article-journal',
    title: 'Energy quality, emergy, and transformity',
    author: [
      { family: 'Brown', given: 'Mark T.' },
      { family: 'Ulgiati', given: 'Sergio' },
    ],
    issued: { 'date-parts': [['2004', 10]] },
  },
  {
    id: '123456/EFGH5678',
    type: 'book',
    title: 'Environmental accounting',
    author: [{ family: 'Odum', given: 'Howard T.' }],
    issued: { raw: '1996' },
  },
  { id: '123456/NOTE0001', type: 'document' }, // a standalone note: no title
];

describe('zoteroSearchRequest', () => {
  test('Zotero on this computer: a simple GET with no custom headers, so no CORS preflight', () => {
    // Zotero's local server does not answer preflight (OPTIONS) requests,
    // so the API version goes in the query (v=3) instead of a header.
    assert.deepStrictEqual(zoteroSearchRequest(LOCAL, 'odum energy'), {
      url: 'http://localhost:23119/api/users/0/items/top?v=3&format=csljson&limit=25&q=odum+energy',
      headers: {},
    });
  });

  test('the web library: the user’s ID, and the API key as a header', () => {
    assert.deepStrictEqual(zoteroSearchRequest(WEB, 'brown'), {
      url: 'https://api.zotero.org/users/123456/items/top?v=3&format=csljson&limit=25&q=brown',
      headers: { 'Zotero-API-Key': 'k3y' },
    });
  });
});

describe('parseZoteroItems', () => {
  test('a summary for each titled item, newest Zotero shapes included', () => {
    const hits = parseZoteroItems({ items: ITEMS });
    assert.deepStrictEqual(
      hits.map(({ title, creators, year }) => ({ title, creators, year })),
      [
        {
          title: 'Energy quality, emergy, and transformity',
          creators: 'Brown and Ulgiati',
          year: '2004',
        },
        { title: 'Environmental accounting', creators: 'Odum', year: '1996' },
      ]
    );
    assert.strictEqual(hits[0].csl, ITEMS[0]);
  });

  test('accepts a bare array; summarises three or more authors with et al.', () => {
    const hits = parseZoteroItems([
      {
        type: 'book',
        title: 'T',
        author: [{ family: 'A' }, { family: 'B' }, { literal: 'C Group' }],
      },
    ]);
    assert.deepStrictEqual(
      hits.map(({ creators, year }) => ({ creators, year })),
      [{ creators: 'A et al.', year: '' }]
    );
    assert.deepStrictEqual(parseZoteroItems({ nothing: true }), []);
    assert.deepStrictEqual(parseZoteroItems(null), []);
  });
});

describe('searchZotero', () => {
  const answer = (respond: () => Response | Promise<Response>) => ({
    fetch: (async () => respond()) as unknown as typeof fetch,
  });
  const failure = async (
    source: Parameters<typeof searchZotero>[0],
    respond: () => Response | Promise<Response>,
    query = 'x'
  ) => {
    const r = await searchZotero(source, query, answer(respond));
    assert.ok(!r.ok);
    return r.message;
  };

  test('returns the hits', async () => {
    const r = await searchZotero(
      LOCAL,
      'energy',
      answer(() => Response.json({ items: ITEMS }))
    );
    assert.ok(r.ok);
    assert.strictEqual(r.hits.length, 2);
  });

  test('explains what to check when Zotero on this computer does not answer', async () => {
    assert.match(
      await failure(LOCAL, () =>
        Promise.reject(new TypeError('Failed to fetch'))
      ),
      /Start Zotero 7.*Allow other applications on this computer to communicate with Zotero.*local network/s
    );
    assert.match(
      await failure(LOCAL, () => new Response('', { status: 403 })),
      /local API is turned off/
    );
    assert.match(
      await failure(LOCAL, () => new Response('', { status: 404 })),
      /update to Zotero 7/
    );
  });

  test('explains web library problems', async () => {
    assert.match(
      await failure({ kind: 'web', userId: 'me', apiKey: '' }, () =>
        Response.json([])
      ),
      /user ID \(a number/
    );
    assert.match(
      await failure(WEB, () => new Response('', { status: 403 })),
      /API key/
    );
    assert.match(
      await failure(WEB, () => new Response('', { status: 404 })),
      /No Zotero library for user 123456/
    );
    assert.match(
      await failure(WEB, () => Promise.reject(new TypeError('x'))),
      /Couldn’t reach api\.zotero\.org/
    );
    assert.match(
      await failure(WEB, () => new Response('', { status: 500 })),
      /Zotero answered 500/
    );
    assert.match(
      await failure(WEB, () => new Response('<html>')),
      /not a Zotero search result/
    );
    assert.match(
      await failure(WEB, () => Response.json([]), '  '),
      /Type something to search for/
    );
  });
});
