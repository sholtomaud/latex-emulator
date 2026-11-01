import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseBib } from './bib-parser.ts';

describe('parseBib', () => {
  test('entries, fields, braces and quotes', () => {
    const { entries } = parseBib(
      '@Article{Key1,\n  Author = {A. {B} C},\n  title = "The {X} {\\"o}",\n  year = 1999,\n}'
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].type, 'article');
    assert.strictEqual(entries[0].key, 'Key1');
    assert.deepStrictEqual(Object.fromEntries(entries[0].fields), {
      author: 'A. {B} C',
      title: 'The {X} {\\"o}',
      year: '1999',
    });
  });

  test('@string macros, # concatenation and predefined macros', () => {
    const { entries } = parseBib(
      '@string{j = "J. Phys"}\n@misc{k, journal = j # " " # {A}, month = jan}',
      new Map([['jan', 'January']])
    );
    assert.strictEqual(entries[0].fields.get('journal'), 'J. Phys A');
    assert.strictEqual(entries[0].fields.get('month'), 'January');
  });

  test('whitespace in values is compressed and trimmed', () => {
    const { entries } = parseBib('@misc{k, title = {  A \n\n   B  }}');
    assert.strictEqual(entries[0].fields.get('title'), 'A B');
  });

  test('parenthesised entries, @comment and @preamble', () => {
    // As real bibtex: @comment only skips its own word, so an entry written
    // inside its braces is still read.
    const { entries, preamble } = parseBib(
      '@comment{ignored @misc{x, title={no}} }\n@preamble{"\\def\\x{}" # "y"}\n@misc(k2, title = {T})'
    );
    assert.deepStrictEqual(
      entries.map((e) => e.key),
      ['x', 'k2']
    );
    assert.strictEqual(preamble, '\\def\\x{}y');
  });

  test('undefined macros and duplicate keys warn but do not fail', () => {
    const { entries, warnings } = parseBib(
      '@misc{k, title = nomacro}\n@misc{K, title = {dup}}'
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].fields.get('title'), '');
    assert.strictEqual(warnings.length, 2);
  });

  test('text outside entries is ignored; unterminated entries warn', () => {
    const { entries, warnings } = parseBib(
      'junk\n@misc{k, title = {T}}\n@misc{broken, title = {x'
    );
    assert.deepStrictEqual(
      entries.map((e) => e.key),
      ['k']
    );
    assert.ok(warnings.length >= 1);
  });
});

describe('source positions (for tools that edit .bib files)', () => {
  const text =
    '% my refs\n@string{acm = "ACM"}\n@Article{k1,\n  Title = {A {B} c},\n  month = may,\n  publisher = acm # " Press",\n  year = 1999\n}\n\nbetween\n@misc(k2, note = "x")';

  test('each entry has the span of its source text', () => {
    const { entries } = parseBib(text);
    assert.deepStrictEqual(
      entries.map((e) => text.slice(e.span.start, e.span.end)),
      [
        '@Article{k1,\n  Title = {A {B} c},\n  month = may,\n  publisher = acm # " Press",\n  year = 1999\n}',
        '@misc(k2, note = "x")',
      ]
    );
  });

  test('each field keeps its raw value as written (macros unexpanded)', () => {
    const [k1, k2] = parseBib(text).entries;
    assert.deepStrictEqual(
      [...k1.raw],
      [
        ['title', '{A {B} c}'],
        ['month', 'may'],
        ['publisher', 'acm # " Press"'],
        ['year', '1999'],
      ]
    );
    assert.deepStrictEqual([...k2.raw], [['note', '"x"']]);
  });
});
