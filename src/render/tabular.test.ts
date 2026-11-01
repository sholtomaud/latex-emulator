import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parse } from '../latex/parser/parser.ts';
import type { EnvironmentNode } from '../latex/ast/nodes.ts';
import { keyText } from '../latex/ast/to-latex.ts';
import { parseColumnSpec, tabularRows } from './tabular.ts';

const ctx = { textwidth: 360, em: 11, ex: 4.71 };

/** The tabular environment of `tex`. */
function tabular(tex: string): EnvironmentNode {
  const [env] = parse(tex).root.children;
  assert.ok(env.kind === 'environment');
  return env;
}
const spec = (s: string) => {
  const env = tabular(`\\begin{tabular}{${s}}\\end{tabular}`);
  return parseColumnSpec(env.args.find((a) => !a.optional)!.children, ctx);
};
const brief = (s: string) =>
  spec(s).columns.map((c) =>
    c.kind === 'cell'
      ? `${c.align}${c.width !== undefined ? `(${c.width.toFixed(1)})` : ''}${c.padLeft ? '' : '<'}${c.padRight ? '' : '>'}`
      : c.kind === 'rule'
        ? '|'
        : c.kind === 'gap'
          ? '_'
          : `@${keyText(c.nodes)}`
  );

describe('parseColumnSpec', () => {
  test('alignments and rules', () => {
    assert.deepStrictEqual(brief('|l|c|r|'), [
      '|',
      'l',
      '|',
      'c',
      '|',
      'r',
      '|',
    ]);
    assert.deepStrictEqual(brief('l || r'), ['l', '|', '_', '|', 'r']);
  });

  test('p{width} columns; *{n}{…} repeats', () => {
    assert.deepStrictEqual(brief('p{0.5\\textwidth}r'), ['p(180.0)', 'r']);
    assert.deepStrictEqual(brief('*{3}{c}|'), ['c', 'c', 'c', '|']);
    assert.deepStrictEqual(brief('l*{2}{|r}'), ['l', '|', 'r', '|', 'r']);
  });

  test('@{} removes the column padding on both sides; @{text} is a column', () => {
    assert.deepStrictEqual(brief('@{}lrr@{}'), ['l<', 'r', 'r>']);
    assert.deepStrictEqual(brief('r@{.}l'), ['r>', '@.', 'l<']);
  });

  test('unsupported specifiers are reported, not fatal', () => {
    const r = spec('>{\\bfseries}lX');
    assert.deepStrictEqual(
      r.columns.map((c) => c.kind),
      ['cell']
    );
    assert.deepStrictEqual(r.problems, ['>{…}', 'X']);
  });

  test('commands and specials in a spec are unsupported; p needs a width', () => {
    assert.deepStrictEqual(spec('l\\vline r').problems, ['\\vline']);
    assert.deepStrictEqual(spec('l~').problems, ['~']);
    // p without its group, or with a width we can't read: a plain p column.
    assert.deepStrictEqual(brief('p'), ['p']);
    assert.deepStrictEqual(brief('p{wide}'), ['p']);
    // @ without a group is just a padding remover.
    assert.deepStrictEqual(brief('l@'), ['l>']);
  });
});

describe('tabularRows', () => {
  const rows = (body: string) =>
    tabularRows(
      tabular(`\\begin{tabular}{lll}${body}\\end{tabular}`).children
    ).map((r) =>
      r.kind === 'cells'
        ? r.cells
            .map(
              (c) =>
                `${keyText(c.nodes).trim()}${c.span > 1 ? `×${c.span}` : ''}${c.columns ? `[${c.columns.length}]` : ''}`
            )
            .join(' & ')
        : r.kind === 'rule'
          ? r.rule
          : `${r.rule}${r.from}-${r.to}${r.trimLeft ? 'l' : ''}${r.trimRight ? 'r' : ''}`
    );

  test('cells at &, rows at \\\\, rules between rows', () => {
    assert.deepStrictEqual(
      rows('\\hline a & b \\\\ \\hline\\hline c & d & e \\\\ \\hline'),
      ['hline', 'a & b', 'hline', 'hline', 'c & d & e', 'hline']
    );
  });

  test('booktabs rules, \\cline and \\cmidrule with trims', () => {
    assert.deepStrictEqual(
      rows(
        '\\toprule a \\\\ \\cmidrule(lr){1-2} \\cline{2-3} b \\\\ \\midrule c \\\\ \\bottomrule'
      ),
      [
        'toprule',
        'a',
        'cmidrule1-2lr',
        'cline2-3',
        'b',
        'midrule',
        'c',
        'bottomrule',
      ]
    );
  });

  test('\\multicolumn spans columns with its own spec; a final row without \\\\ counts', () => {
    assert.deepStrictEqual(
      rows('\\multicolumn{2}{|l|}{Total} & 2 \\\\ x & y'),
      ['Total×2[3] & 2', 'x & y']
    );
  });

  test('\\cmidrule tolerates spaces; a bad range draws nothing; spans default to 1', () => {
    assert.deepStrictEqual(rows('a \\\\ \\cmidrule (r) {2-3} \\cline{x} b'), [
      'a',
      'cmidrule2-3r',
      'b',
    ]);
    assert.deepStrictEqual(rows('\\multicolumn{two}{c}{x}'), ['x[1]']);
  });

  test('a trailing \\\\ makes no empty row', () => {
    assert.deepStrictEqual(rows('a \\\\ '), ['a']);
  });
});
