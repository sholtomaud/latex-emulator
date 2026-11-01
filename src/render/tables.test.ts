import { describe, test } from 'node:test';
import assert from 'node:assert';
import { renderDocument } from './render-document.ts';
import { serialize } from './hnode.ts';
import type { HChild } from './hnode.ts';

const doc = (body: string) =>
  `\\documentclass{article}\\usepackage{booktabs}\\begin{document}${body}\\end{document}`;
const render = (body: string) => renderDocument(doc(body), {});
const html = (body: string) =>
  render(body).tree.children.map(serialize).join('');
const textOf = (children: HChild[]): string =>
  children
    .map((c) => (typeof c === 'string' ? c : textOf(c.children)))
    .join('');

describe('tabular', () => {
  test('rule columns, cell alignment, \\hline rows and \\multicolumn', () => {
    assert.strictEqual(
      html(
        '\\begin{tabular}{|l|c|r|}\\hline a & b & c \\\\ \\hline\\hline \\multicolumn{2}{|l|}{T} & 2 \\\\ \\hline\\end{tabular}'
      ),
      '<div class="tabular"><table><tbody>' +
        '<tr class="hline"><td colspan="7"></td></tr>' +
        '<tr><td class="vrule"></td><td class="l">a</td><td class="vrule"></td><td class="c">b</td><td class="vrule"></td><td class="r">c</td><td class="vrule"></td></tr>' +
        '<tr class="hline"><td colspan="7"></td></tr>' +
        '<tr class="hgap"><td colspan="7"></td></tr>' +
        '<tr class="hline"><td colspan="7"></td></tr>' +
        '<tr><td class="vrule"></td><td class="l" colspan="3">T</td><td class="vrule"></td><td class="r">2</td><td class="vrule"></td></tr>' +
        '<tr class="hline"><td colspan="7"></td></tr>' +
        '</tbody></table></div>'
    );
  });

  test('booktabs rules, \\cmidrule trims, @{} padding and missing cells', () => {
    assert.strictEqual(
      html(
        '\\begin{tabular}{@{}lr@{}}\\toprule A & B \\\\ \\cmidrule(r){1-1} x \\\\ \\midrule y & 1 \\\\ \\bottomrule\\end{tabular}'
      ),
      '<div class="tabular"><table><tbody>' +
        '<tr class="toprule"><td colspan="2"></td></tr>' +
        '<tr><td class="l nopad-l">A</td><td class="r nopad-r">B</td></tr>' +
        '<tr class="cmidrule"><td class="rule trim-r"></td><td></td></tr>' +
        '<tr><td class="l nopad-l">x</td><td class="r nopad-r"></td></tr>' +
        '<tr class="midrule"><td colspan="2"></td></tr>' +
        '<tr><td class="l nopad-l">y</td><td class="r nopad-r">1</td></tr>' +
        '<tr class="bottomrule"><td colspan="2"></td></tr>' +
        '</tbody></table></div>'
    );
  });

  test('p{width} columns carry their width; @{text} is a column in every row', () => {
    const out = html(
      '\\begin{tabular}{p{2cm}r@{.}l}a & 3 & 14 \\\\\\end{tabular}'
    );
    assert.match(
      out,
      /<td class="p" style="width: 56\.6929pt">a<\/td><td class="r nopad-r">3<\/td><td class="sep">\.<\/td><td class="l nopad-l">14<\/td>/
    );
  });

  test('unsupported column types warn at the tabular', () => {
    const r = render('\\begin{tabular}{lX}a & b\\end{tabular}');
    assert.deepStrictEqual(
      r.diagnostics.map((d) => [d.code, d.message]),
      [
        [
          'syntax/unsupported-column',
          'Column type X is not supported by the emulator.',
        ],
      ]
    );
  });
});

describe('floats and captions', () => {
  test('a table float: numbered caption, labels and \\ref', () => {
    const r = render(
      'See Table~\\ref{t}.\\begin{table}[h]\\centering\\caption{Results.}\\label{t}\\begin{tabular}{l}x\\end{tabular}\\end{table}'
    );
    const out = r.tree.children.map(serialize).join('');
    assert.match(
      out,
      /^<p>See Table 1\.<\/p><div class="float table"><div class="centering"><p class="caption"><span class="caption-label">Table 1: <\/span>Results\.<\/p><div class="tabular">/
    );
    assert.deepStrictEqual(r.diagnostics, []);
  });

  test('figures count separately; captions take an optional list entry', () => {
    const text = textOf(
      render(
        '\\begin{figure}\\caption[Short]{A figure.}\\end{figure}\\begin{table}\\caption{A table.}\\end{table}\\begin{figure*}\\caption{Another.}\\end{figure*}'
      ).tree.children
    );
    assert.strictEqual(
      text.replace(/ /g, ' '),
      'Figure 1: A figure.Table 1: A table.Figure 2: Another.'
    );
  });

  test('\\caption outside a float is an error, shown anyway', () => {
    const r = render('\\caption{Loose.}');
    assert.deepStrictEqual(
      r.diagnostics.map((d) => [d.code, d.severity]),
      [['syntax/caption-outside-float', 'error']]
    );
    assert.match(r.tree.children.map(serialize).join(''), /Loose\./);
  });
});
