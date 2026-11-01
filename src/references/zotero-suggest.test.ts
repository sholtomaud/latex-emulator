import { test } from 'node:test';
import assert from 'node:assert';
import { zoteroSuggestions } from './zotero-suggest.ts';
import { parseZoteroItems } from './zotero.ts';

test('Zotero hits become keyed entries, unique against the library and each other', () => {
  const hits = parseZoteroItems({
    items: [
      {
        type: 'book',
        title: 'Environmental accounting',
        author: [{ family: 'Odum', given: 'H. T.' }],
        issued: { 'date-parts': [[1996]] },
      },
      {
        type: 'book',
        title: 'Environment and society',
        author: [{ family: 'Odum', given: 'H. T.' }],
        issued: { 'date-parts': [[2007]] },
      },
      {
        type: 'article-journal',
        title: 'Environmental energetics',
        author: [{ family: 'Odum', given: 'H. T.' }],
        issued: { 'date-parts': [[1996]] },
      },
    ],
  });
  const s = zoteroSuggestions(hits, new Set(['odum_environmental_1996']));
  assert.deepStrictEqual(
    s.map(({ key, authors, year, title }) => ({ key, authors, year, title })),
    [
      {
        key: 'odum_environmental_1996a',
        authors: 'Odum',
        year: '1996',
        title: 'Environmental accounting',
      },
      {
        key: 'odum_environment_2007',
        authors: 'Odum',
        year: '2007',
        title: 'Environment and society',
      },
      {
        key: 'odum_environmental_1996b',
        authors: 'Odum',
        year: '1996',
        title: 'Environmental energetics',
      },
    ]
  );
  assert.match(s[0].text, /^@book\{odum_environmental_1996a,\n/);
  assert.deepStrictEqual(
    zoteroSuggestions(
      [{ title: 'x', creators: '', year: '', csl: null }],
      new Set()
    ),
    []
  );
});
