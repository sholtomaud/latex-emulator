import { describe, test } from 'node:test';
import assert from 'node:assert';
import { formatCitation, natbibOptions, parseBibitemLabel } from './natbib.ts';
import type { BibLabel, CitationRequest } from './natbib.ts';

const labels = new Map<string, BibLabel>(
  [
    parseBibitemLabel('Odum(1996)', 'odum', 1),
    parseBibitemLabel('Odum(2007)', 'odum2', 2),
    parseBibitemLabel('van~der Waals(1873)', 'vdw', 3),
  ].map((l) => [l.key, l])
);
const cite = (
  command: string,
  keys: string[],
  extra: Partial<CitationRequest> = {},
  options = natbibOptions([], 'plainnat')
) =>
  formatCitation(
    { command, star: false, notes: [], keys, ...extra },
    labels,
    'natbib',
    options
  ).latex;

describe('natbibOptions (natbib.sty)', () => {
  const punct = (o: ReturnType<typeof natbibOptions>) =>
    `${o.open}${o.sep}${o.close} ${o.numbers ? 'n' : 'a'} "${o.aysep}" "${o.yrsep}"`;

  test('defaults: round brackets, semicolon, author–year', () => {
    assert.strictEqual(punct(natbibOptions([])), '(;) a "," ","');
  });
  test('\\bibliographystyle applies natbib’s \\bibstyle@<name>', () => {
    assert.strictEqual(punct(natbibOptions([], 'plainnat')), '[,] a "," ","');
    assert.strictEqual(punct(natbibOptions([], 'plain')), '[,] n "" ","');
    assert.strictEqual(punct(natbibOptions([], 'agsm')), '(,) a "" ","');
    assert.strictEqual(punct(natbibOptions([], 'nosuch')), '(;) a "," ","');
  });
  test('punctuation options switch the style’s punctuation off', () => {
    assert.strictEqual(
      punct(natbibOptions(['round'], 'plainnat')),
      '(;) a "," ","'
    );
    assert.strictEqual(
      punct(natbibOptions(['numbers'], 'plainnat')),
      '[,] n "," ","'
    );
    // authoryear switches it back on.
    assert.strictEqual(
      punct(natbibOptions(['authoryear'], 'plainnat')),
      '[,] a "," ","'
    );
  });
  test('options run in natbib’s declaration order, not the order given', () => {
    // semicolon is declared after numbers, so it wins.
    assert.strictEqual(
      punct(natbibOptions(['semicolon', 'numbers'])),
      '[;] n "," ","'
    );
    assert.strictEqual(
      punct(natbibOptions(['curly', 'colon'])),
      '\\{;\\} a "," ","'
    );
    assert.strictEqual(natbibOptions(['angle']).open, '$<$');
  });
});

describe('parseBibitemLabel', () => {
  test('splits Short(Year)Long at brace level 0', () => {
    const l = parseBibitemLabel('A {(x)}(1955{\\natexlab{a}})', 'k', 1);
    assert.strictEqual(l.short, 'A {(x)}');
    assert.strictEqual(l.year, '1955{\\natexlab{a}}');
    assert.strictEqual(l.long, 'A {(x)}');
  });
  test('labels without a year are numerical', () => {
    assert.strictEqual(parseBibitemLabel('Knuth', 'k', 4).numeric, true);
    assert.strictEqual(parseBibitemLabel('A(1', 'k', 4).numeric, true);
    assert.strictEqual(parseBibitemLabel(undefined, 'k', 4).text, '4');
  });
});

describe('author–year details', () => {
  test('undefined keys in every form', () => {
    for (const c of ['citeauthor', 'citeyear', 'citealp', 'citealt', 'citet'])
      assert.strictEqual(cite(c, ['nope']), '\\textbf{?}');
    assert.strictEqual(cite('citeyearpar', ['nope']), '[\\textbf{?}]');
  });
  test('same authors, different years: years joined by \\NAT@yrsep', () => {
    assert.strictEqual(cite('citep', ['odum', 'odum2']), '[Odum, 1996, 2007]');
  });
  test('\\NAT@aysep comes from the style (agsm has none)', () => {
    assert.strictEqual(
      cite('citep', ['odum'], {}, natbibOptions([], 'agsm')),
      '(Odum 1996)'
    );
  });
  test('\\Citeauthor capitalises; \\citealt takes notes', () => {
    assert.strictEqual(cite('Citeauthor', ['vdw']), 'Van~der Waals');
    assert.strictEqual(
      cite('citealt', ['odum'], { notes: ['p.~2'] }),
      'Odum 1996, p.~2'
    );
  });
  test('classic LaTeX prints the label as given', () => {
    const r = formatCitation(
      { command: 'cite', star: false, notes: ['p.~2'], keys: ['odum', 'x'] },
      labels,
      'classic',
      natbibOptions([])
    );
    assert.strictEqual(r.latex, '[Odum(1996), \\textbf{?}, p.~2]');
    assert.deepStrictEqual(r.undefinedKeys, ['x']);
  });
});
