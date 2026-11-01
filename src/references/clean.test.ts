import { describe, test } from 'node:test';
import assert from 'node:assert';
import { cleanBib } from './clean.ts';

describe('cleanBib', () => {
  test('canonical layout; everything between entries is kept', () => {
    const text =
      '% my references\n@string{acm = "ACM"}\n\n@ARTICLE{ k1 , Title="A {B} c",\n journal = acm # " Press", year=1999 }\n\nfree text\n@Comment{x}\n';
    const { text: out, changes } = cleanBib(text);
    assert.strictEqual(
      out,
      '% my references\n@string{acm = "ACM"}\n\n@article{k1,\n  title = {A {B} c},\n  journal = acm # " Press",\n  year = {1999},\n}\n\nfree text\n@Comment{x}\n'
    );
    assert.deepStrictEqual(changes, []);
  });

  test('cleaned output is stable', () => {
    const once = cleanBib(
      '@book{k, title = "T", pages = "1-2", month = "May"}'
    ).text;
    assert.strictEqual(cleanBib(once).text, once);
  });

  test('fixes DOIs, duplicate DOI URLs, page ranges, months and empty fields', () => {
    const { text, changes } = cleanBib(
      `@article{k,
  doi = {https://doi.org/10.1/ABC},
  url = {https://doi.org/10.1/abc},
  pages = {201-213},
  month = {May},
  note = {},
  number = "1 – 2",
}
@misc{m, doi = {doi:10.2/x}, month = {12}, month2 = {Mayday}, pages = {e1234}}`
    );
    assert.strictEqual(
      text,
      `@article{k,
  doi = {10.1/ABC},
  pages = {201--213},
  month = may,
  number = {1--2},
}
@misc{m,
  doi = {10.2/x},
  month = dec,
  month2 = {Mayday},
  pages = {e1234},
}
`
    );
    assert.deepStrictEqual(changes, [
      'k: doi without its URL prefix',
      'k: removed url (the DOI link)',
      'k: pages 201-213 → 201--213',
      'k: month May → may',
      'k: removed empty note',
      'k: number 1 – 2 → 1--2',
      'm: doi without its URL prefix',
      'm: month 12 → dec',
    ]);
  });

  test('leaves entries BibTeX would skip as they were', () => {
    const text =
      '@book{dup, title = {First}}\n@book{dup, title = {Second}}\n@book{broken, title = {x}\n';
    assert.strictEqual(
      cleanBib(text).text,
      '@book{dup,\n  title = {First},\n}\n@book{dup, title = {Second}}\n@book{broken, title = {x}\n'
    );
  });
});
