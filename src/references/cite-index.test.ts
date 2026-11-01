import { describe, test } from 'node:test';
import assert from 'node:assert';
import { indexLibrary, matchEntries } from './cite-index.ts';
import { SAMPLE_REFERENCES } from '../store/sample-references.ts';

const index = indexLibrary({
  references: SAMPLE_REFERENCES,
  mylib:
    '@article{patten_information_1963, author = {Patten, Bernard C.}, title = {Information processing behavior of a natural {plankton} community}, journal = {Am. Zool.}, year = 1963}\n@misc{vdw_1873, author = {van der Waals, J. D. and Smith, A. and Jones, B.}, title = {Over de {C}ontinu\\"{\\i}teit}, date = {1873-01-01}}',
});

describe('indexLibrary', () => {
  test('one entry per key with short authors, year, plain title and file', () => {
    const patten = index.find((e) => e.key === 'patten_information_1963');
    assert.deepStrictEqual(patten, {
      key: 'patten_information_1963',
      file: 'mylib',
      authors: 'Patten',
      year: '1963',
      title: 'Information processing behavior of a natural plankton community',
    });
    assert.strictEqual(
      index.find((e) => e.key === 'brown_energy_2004')?.authors,
      'Brown and Ulgiati'
    );
    const vdw = index.find((e) => e.key === 'vdw_1873')!;
    assert.deepStrictEqual(
      [vdw.authors, vdw.year, vdw.title],
      ['van der Waals et al.', '1873', 'Over de Continuïteit']
    );
    assert.strictEqual(index.length, 7);
  });
});

describe('matchEntries', () => {
  const keys = (prefix: string) =>
    matchEntries(index, prefix).map((e) => e.key);

  test('key prefixes first, then words in keys, authors and titles', () => {
    assert.deepStrictEqual(keys('pat'), ['patten_information_1963']);
    assert.deepStrictEqual(keys('PLANK'), ['patten_information_1963']);
    assert.deepStrictEqual(keys('ulgiati'), ['brown_energy_2004']);
    assert.deepStrictEqual(keys('1984'), ['knuth_texbook_1984']);
    assert.strictEqual(keys('l')[0], 'lamport_latex_1994');
  });

  test('an empty prefix lists everything by key; the limit applies', () => {
    assert.strictEqual(keys('').length, 7);
    assert.deepStrictEqual(keys(''), [...keys('')].sort());
    assert.strictEqual(matchEntries(index, '', 3).length, 3);
    assert.deepStrictEqual(keys('zzz'), []);
  });
});

describe('indexLibrary: titles as plain text', () => {
  test('logos keep their names, formatting commands vanish, escapes print', () => {
    const [e] = indexLibrary({
      x: '@book{k, title = {{\\LaTeX} and {\\TeX}: \\emph{Tips} \\& Tricks for 50\\%}}',
    });
    assert.strictEqual(e.title, 'LaTeX and TeX: Tips & Tricks for 50%');
  });
});
