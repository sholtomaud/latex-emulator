import { describe, test } from 'node:test';
import assert from 'node:assert';
import { renderDocument } from './render-document.ts';
import { serialize } from './hnode.ts';
import type { HChild } from './hnode.ts';

const doc = (body: string) =>
  `\\documentclass{article}\\usepackage{amsmath}\\begin{document}${body}\\end{document}`;
const render = (body: string) => renderDocument(doc(body), {});
const html = (body: string) =>
  render(body).tree.children.map(serialize).join('');
const textOf = (children: HChild[]): string =>
  children
    .map((c) => (typeof c === 'string' ? c : textOf(c.children)))
    .join('');

describe('math in the document', () => {
  test('inline math becomes MathML in the paragraph', () => {
    assert.strictEqual(
      html('So $E = mc^2$ holds.'),
      '<p>So <math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math> holds.</p>'
    );
  });

  test('equation: a centred display with its number at the right', () => {
    assert.strictEqual(
      html('A\\begin{equation} x = 1 \\end{equation}B'),
      '<p>A</p><div class="math-display cols-1"><div class="math-row"><div class="math-cell c1"><math displaystyle="true"><mi>x</mi><mo>=</mo><mn>1</mn></math></div><span class="eqno">(1)</span></div></div><p class="noindent">B</p>'
    );
  });

  test('unnumbered displays: \\[ \\], $$ $$, equation*, displaymath', () => {
    for (const body of [
      '\\[x\\]',
      '$$x$$',
      '\\begin{equation*}x\\end{equation*}',
      '\\begin{displaymath}x\\end{displaymath}',
    ])
      assert.strictEqual(
        html(body),
        '<div class="math-display cols-1"><div class="math-row"><div class="math-cell c1"><math displaystyle="true"><mi>x</mi></math></div></div></div>',
        body
      );
  });

  test('align: one grid column per cell, a number per row, \\nonumber skipped', () => {
    const out = html(
      '\\begin{align} f &= a \\\\ &= b \\nonumber \\\\ &= c \\end{align}'
    );
    assert.match(out, /^<div class="math-display cols-2">/);
    const rows = out.split('<div class="math-row">').slice(1);
    assert.strictEqual(rows.length, 3);
    assert.match(
      rows[0],
      /^<div class="math-cell c1"><math displaystyle="true"><mi>f<\/mi><\/math><\/div><div class="math-cell c2"><math displaystyle="true"><mo>=<\/mo><mi>a<\/mi><\/math><\/div><span class="eqno">\(1\)<\/span>/
    );
    assert.doesNotMatch(rows[1], /eqno/);
    assert.match(rows[2], /<span class="eqno">\(2\)<\/span>/);
    assert.doesNotMatch(
      html('\\begin{align*} a &= b \\\\ c &= d \\end{align*}'),
      /eqno/
    );
  });

  test('gather centres rows; multline numbers its last row; \\tag replaces the number', () => {
    const gather = html('\\begin{gather} a \\\\ b \\end{gather}');
    assert.strictEqual((gather.match(/eqno/g) ?? []).length, 2);
    const multline = html('\\begin{multline} a \\\\ b \\\\ c \\end{multline}');
    assert.strictEqual((multline.match(/class="eqno"/g) ?? []).length, 1);
    assert.match(
      multline,
      /<mi>c<\/mi><\/math><\/div><span class="eqno">\(1\)<\/span>/
    );
    assert.match(
      html('\\begin{equation} x \\tag{*} \\end{equation}'),
      /<span class="eqno">\(\*\)<\/span>/
    );
  });
});

describe('cross-references (two passes, like .aux)', () => {
  test('\\ref and \\eqref resolve, also forwards', () => {
    const r = render(
      'See \\eqref{eq:e} in Section~\\ref{sec:a}.\\section{A}\\label{sec:a}\\begin{equation} x \\label{eq:e}\\end{equation}\\begin{align} a \\label{eq:f}\\\\ b \\end{align}Then \\eqref{eq:f}.'
    );
    const text = textOf(r.tree.children).replace(/ /g, ' ');
    assert.match(text, /^See \(1\) in Section 1\./);
    assert.match(text, /Then \(2\)\.$/);
    assert.deepStrictEqual(
      r.diagnostics.filter((d) => d.source === 'ref'),
      []
    );
  });

  test('labels in lists, footnotes and subsections take their counter', () => {
    const text = textOf(
      render(
        '\\section{A}\\subsection{B}\\label{s}\\begin{enumerate}\\item x\\item y\\label{i}\\end{enumerate}Note\\footnote{n\\label{fn}}. \\ref{s}, \\ref{i}, \\ref{fn}.'
      ).tree.children
    );
    assert.match(text, /1\.1, 2, 1\./);
  });

  test('undefined and duplicate labels warn; \\pageref is ?? with an info note', () => {
    const r = render(
      '\\ref{nope} \\pageref{a}\\section{A}\\label{a}\\section{B}\\label{a}'
    );
    assert.match(html('\\ref{nope}'), /<span class="unresolved">\?\?<\/span>/);
    const codes = r.diagnostics.map((d) => `${d.code}:${d.severity}`);
    assert.ok(codes.includes('ref/undefined-reference:warning'));
    assert.ok(codes.includes('ref/pageref:info'));
    assert.ok(codes.includes('ref/duplicate-label:warning'));
    // The first definition wins, as in LaTeX's .aux.
    assert.match(
      textOf(
        render('\\ref{a}\\section{A}\\label{a}\\section{B}\\label{a}').tree
          .children
      ),
      /^1/
    );
  });

  test('math diagnostics reach the editor once (not once per pass)', () => {
    const r = render('$\\frob$');
    assert.strictEqual(
      r.diagnostics.filter((d) => d.code === 'math/unsupported-command').length,
      1
    );
  });
});

describe('\\tableofcontents', () => {
  test('a Contents section listing numbered sections, page numbers ??', () => {
    const r = render(
      '\\tableofcontents\\section{Intro}\\subsection{Detail}\\section*{Unnumbered}\\section{End}'
    );
    const out = r.tree.children.map(serialize).join('');
    assert.match(
      out,
      /^<h2 class="section">Contents<\/h2><div class="toc"><p class="toc-section"><span class="toc-num">1<\/span>Intro<span class="toc-page">\?\?<\/span><\/p><p class="toc-subsection"><span class="toc-num">1\.1<\/span>Detail<span class="toc-leaders"><\/span><span class="toc-page">\?\?<\/span><\/p><p class="toc-section"><span class="toc-num">2<\/span>End<span class="toc-page">\?\?<\/span><\/p><\/div>/
    );
    assert.ok(r.diagnostics.some((d) => d.code === 'ref/toc-pages'));
  });
});
