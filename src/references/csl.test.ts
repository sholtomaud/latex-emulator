import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { cslToEntry } from './csl.ts';
import { serializeEntry } from './serialize.ts';
import { parseBib } from '../latex/bibtex/bib-parser.ts';

const brown = JSON.parse(
  fs.readFileSync(
    new URL('../../fixtures/references/brown-2004.csl.json', import.meta.url),
    'utf8'
  )
);

describe('cslToEntry', () => {
  test('a journal article from DOI content negotiation', () => {
    const e = cslToEntry(brown);
    assert.strictEqual(
      serializeEntry('brown_energy_2004', e),
      `@article{brown_energy_2004,
  author = {Brown, Mark T. and Ulgiati, Sergio},
  title = {Energy quality, emergy, and transformity: {H.T.} Odum’s contributions to quantifying and understanding systems},
  journal = {Ecological Modelling},
  volume = {178},
  number = {1--2},
  pages = {201--213},
  publisher = {Elsevier BV},
  year = {2004},
  month = oct,
  doi = {10.1016/j.ecolmodel.2003.12.032},
}
`
    );
  });

  test('the output is a valid .bib entry with the same values', () => {
    const [entry] = parseBib(
      serializeEntry('k', cslToEntry(brown)),
      new Map([['oct', 'October']])
    ).entries;
    assert.strictEqual(entry.fields.get('month'), 'October');
    assert.strictEqual(entry.fields.get('pages'), '201--213');
  });

  test('entry types', () => {
    const type = (t: string) => cslToEntry({ type: t, title: 'T' }).type;
    assert.deepStrictEqual(
      [
        'article-journal',
        'journal-article',
        'book',
        'chapter',
        'book-chapter',
        'paper-conference',
        'proceedings-article',
        'report',
        'thesis',
        'dataset',
        'posted-content',
        'webpage',
      ].map(type),
      [
        'article',
        'article',
        'book',
        'incollection',
        'incollection',
        'inproceedings',
        'inproceedings',
        'techreport',
        'phdthesis',
        'misc',
        'misc',
        'misc',
      ]
    );
  });

  test('container, publisher and identifiers go where the type expects them', () => {
    const chapter = cslToEntry({
      type: 'chapter',
      title: ['A chapter'],
      'container-title': ['The Book'],
      'collection-title': 'Series',
      editor: [{ family: 'Smith', given: 'Jane' }],
      publisher: 'Pub',
      'publisher-place': 'London',
      ISBN: ['978-0-00-000000-2', '0-00-000000-0'],
      edition: '2',
      published: { 'date-parts': [[1999]] },
      URL: 'https://example.org/chapter',
    });
    assert.strictEqual(
      serializeEntry('k', chapter),
      `@incollection{k,
  editor = {Smith, Jane},
  title = {A chapter},
  booktitle = {The Book},
  series = {Series},
  edition = {2},
  publisher = {Pub},
  address = {London},
  year = {1999},
  isbn = {978-0-00-000000-2},
  url = {https://example.org/chapter},
}
`
    );
    const report = cslToEntry({
      type: 'report',
      title: 'R',
      publisher: 'Inst',
      number: '7',
    });
    assert.deepStrictEqual(report.fields.slice(1), [
      { name: 'number', value: '7' },
      { name: 'institution', value: 'Inst' },
    ]);
    const thesis = cslToEntry({ type: 'thesis', title: 'T', publisher: 'Uni' });
    assert.deepStrictEqual(thesis.fields[1], { name: 'school', value: 'Uni' });
  });

  test('names: particles, suffixes and institutions', () => {
    const e = cslToEntry({
      type: 'book',
      author: [
        { family: 'Waals', given: 'J. D.', 'non-dropping-particle': 'van der' },
        { family: 'King', given: 'Martin Luther', suffix: 'Jr.' },
        { literal: 'World Health Organization' },
        { family: 'Plato' },
      ],
    });
    assert.deepStrictEqual(e.fields[0], {
      name: 'author',
      value:
        'van der Waals, J. D. and King, Jr., Martin Luther and {World Health Organization} and Plato',
    });
  });

  test('escapes LaTeX specials, converts Crossref markup, protects acronyms', () => {
    const e = cslToEntry({
      type: 'article-journal',
      title:
        'R&D of <i>E. coli</i> in CO<sub>2</sub> at 100% and x<sup>2</sup> — the NASA & iPhone_case #1 $5 {x}',
      'container-title': 'Journal of A &amp; B',
    });
    assert.strictEqual(
      e.fields[0].value,
      '{R\\&D} of \\emph{E. coli} in {CO}\\textsubscript{2} at 100\\% and x\\textsuperscript{2} — the {NASA} \\& {iPhone\\_case} \\#1 \\$5 \\{x\\}'
    );
    assert.strictEqual(e.fields[1].value, 'Journal of A \\& B');
  });

  test('dates: issued, then published-print, then created; DOI URLs are not repeated', () => {
    const e = cslToEntry({
      type: 'article-journal',
      'published-print': { 'date-parts': [[2001, 2]] },
      created: { 'date-parts': [[2000, 12, 1]] },
      DOI: '10.1/x',
      URL: 'http://dx.doi.org/10.1/x',
    });
    assert.deepStrictEqual(e.fields, [
      { name: 'year', value: '2001' },
      { name: 'month', value: 'feb', macro: true },
      { name: 'doi', value: '10.1/x' },
    ]);
    assert.deepStrictEqual(
      cslToEntry({ type: 'book', created: { 'date-parts': [[1990]] } }).fields,
      [{ name: 'year', value: '1990' }]
    );
  });

  test('rejects what is not CSL', () => {
    assert.throws(() => cslToEntry(null), /not a CSL-JSON record/);
    assert.throws(() => cslToEntry([1]), /not a CSL-JSON record/);
  });
});

describe('cslToEntry: Zotero date shapes', () => {
  test('string date parts and raw dates', () => {
    const year = (issued: unknown) =>
      cslToEntry({ type: 'book', issued }).fields.find((f) => f.name === 'year')
        ?.value;
    assert.strictEqual(year({ 'date-parts': [['2004', '10']] }), '2004');
    assert.strictEqual(year({ raw: '2004-05-01' }), '2004');
    assert.strictEqual(year({ literal: 'circa 1850' }), '1850');
    assert.strictEqual(year({ raw: 'undated' }), undefined);
  });
});
