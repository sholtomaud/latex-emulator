import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  bibCacheStats,
  bibKeyIndex,
  clearBibCache,
  parseBibCached,
} from './bib-cache.ts';
import { parseBib } from './bib-parser.ts';

const BIB = '@article{a, title = {A}}\n@book{B_2, title = {B}}\n';

beforeEach(() => clearBibCache());

describe('parseBibCached', () => {
  test('gives the same result as parseBib', () => {
    assert.deepStrictEqual(parseBibCached(BIB), parseBib(BIB));
    const months = new Map([['jan', 'January']]);
    assert.deepStrictEqual(
      parseBibCached('@misc{m, month = jan}', months),
      parseBib('@misc{m, month = jan}', months)
    );
  });

  test('parses a source once, however often it is asked for', () => {
    const first = parseBibCached(BIB);
    assert.strictEqual(parseBibCached(BIB), first);
    // An equal string that is a different object hits the cache too.
    assert.strictEqual(parseBibCached([BIB].join('').slice(0)), first);
    assert.deepStrictEqual(bibCacheStats(), { parses: 1 });
  });

  test('different predefined macros are parsed separately', () => {
    const text = '@misc{m, month = jan}';
    const plain = parseBibCached(text);
    const withMonths = parseBibCached(text, new Map([['jan', 'January']]));
    assert.notStrictEqual(plain, withMonths);
    assert.strictEqual(withMonths.entries[0].fields.get('month'), 'January');
    assert.strictEqual(
      parseBibCached(text, new Map([['jan', 'January']])),
      withMonths
    );
    assert.deepStrictEqual(bibCacheStats(), { parses: 2 });
  });

  test('many small files stay cached', () => {
    for (let i = 0; i < 100; i++) parseBibCached(`@misc{k${i}, title={x}}`);
    const before = bibCacheStats().parses;
    for (let i = 0; i < 100; i++) parseBibCached(`@misc{k${i}, title={x}}`);
    assert.strictEqual(bibCacheStats().parses, before);
  });

  test('large texts are evicted, least recently used first', () => {
    // Three 6M-character texts exceed the 16M budget: the oldest goes.
    const big = (c: string) => `@misc{${c}, title={${c.repeat(6e6)}}}`;
    const [a, b, c] = [big('a'), big('b'), big('c')];
    parseBibCached(a);
    parseBibCached(b);
    parseBibCached(a); // a is now the most recent
    parseBibCached(c); // evicts b
    const before = bibCacheStats().parses;
    parseBibCached(a);
    parseBibCached(c);
    assert.strictEqual(bibCacheStats().parses, before);
    parseBibCached(b);
    assert.strictEqual(bibCacheStats().parses, before + 1);
  });
});

describe('bibKeyIndex', () => {
  test('readable keys, lower-cased', () => {
    const index = bibKeyIndex(BIB);
    assert.deepStrictEqual([...index.readable].sort(), ['a', 'b_2']);
  });

  test('written keys, where @type{key, starts, even when unreadable', () => {
    const source =
      '@article{ok, title={x}}\n\n@book{ Broken ,\n  title = {no close';
    const index = bibKeyIndex(source);
    assert.ok(!index.readable.has('broken'));
    assert.strictEqual(index.written.get('broken'), source.indexOf('@book'));
    assert.strictEqual(index.written.get('ok'), 0);
  });

  test('matches what the per-key regex used to match', () => {
    const source = [
      '@Article ( Paren_1 , title = {x})',
      '@misc{a@b, title={y}}',
      '@comment{ no comma here }',
      '@misc{after_comment, title={z}}',
      'text @foo{inprose, more}',
    ].join('\n');
    const old = (key: string) =>
      new RegExp(
        `@\\s*\\w+\\s*[{(]\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`,
        'i'
      ).exec(source)?.index;
    const index = bibKeyIndex(source);
    for (const key of ['paren_1', 'a@b', 'after_comment', 'inprose', 'nope'])
      assert.strictEqual(index.written.get(key), old(key), key);
  });

  test('is cached with the parse', () => {
    assert.strictEqual(bibKeyIndex(BIB), bibKeyIndex(BIB));
    assert.deepStrictEqual(bibCacheStats(), { parses: 1 });
  });
});
