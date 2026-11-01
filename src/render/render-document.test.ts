import { describe, test } from 'node:test';
import assert from 'node:assert';
import { renderDocument } from './render-document.ts';
import { serialize } from './hnode.ts';

const TODAY = new Date(2026, 9, 31);
/** Rendered body HTML (inside <article>), for a fragment or a full document. */
const html = (src: string) =>
  renderDocument(src, { today: TODAY }).tree.children.map(serialize).join('');
const codes = (src: string) =>
  renderDocument(src, { today: TODAY }).diagnostics.map((d) => d.code);

describe('renderDocument: paragraphs', () => {
  test('blank lines separate paragraphs; whitespace collapses', () => {
    assert.strictEqual(
      html('One\n  line.\n\nTwo'),
      '<p>One line.</p><p>Two</p>'
    );
  });

  test('\\par ends a paragraph', () => {
    assert.strictEqual(html('a\\par b'), '<p>a</p><p>b</p>');
  });

  test('\\noindent', () => {
    assert.strictEqual(html('\\noindent a'), '<p class="noindent">a</p>');
  });

  test('comments are dropped and join lines', () => {
    assert.strictEqual(html('ab%\ncd % x\n'), '<p>abcd</p>');
  });

  test('ligatures, ~ and control symbols', () => {
    assert.strictEqual(
      html("``Hi''~--- 50\\% \\& \\$5 \\{x\\} \\#1 \\_"),
      '<p>“Hi”\u00a0— 50% &amp; $5 {x} #1 _</p>'
    );
  });

  test('\\\\ and \\newline break lines', () => {
    assert.strictEqual(html('a\\\\b\\newline c'), '<p>a<br>b<br>c</p>');
  });

  test('accents and symbols', () => {
    assert.strictEqual(
      html('\\\'ecole \\"{o} \\c c \\ss{} \\S\\ldots'),
      '<p>école ö ç ß §…</p>'
    );
  });

  test('logos and \\today', () => {
    assert.strictEqual(
      html('\\TeX\\ and \\LaTeX, \\today'),
      '<p><span class="logo-tex">T<span class="logo-e">E</span>X</span> and <span class="logo-latex">L<span class="logo-a">A</span>T<span class="logo-e">E</span>X</span>, October 31, 2026</p>'
    );
  });

  test('user text is never interpreted as HTML', () => {
    assert.strictEqual(
      html('<img src=x onerror=alert(1)>'),
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
    );
  });
});

describe('renderDocument: text styles', () => {
  test('font commands', () => {
    assert.strictEqual(
      html(
        '\\emph{e} \\textbf{b} \\textit{i} \\texttt{t} \\textsc{s} \\textsf{f} \\textsl{l} \\textrm{r} \\textup{u} \\textmd{m} \\textnormal{n} \\underline{x}'
      ),
      '<p><em>e</em> <span class="bf">b</span> <span class="it">i</span> <span class="tt">t</span> <span class="sc">s</span> <span class="sf">f</span> <span class="sl">l</span> <span class="rm">r</span> <span class="up">u</span> <span class="md">m</span> <span class="normalfont">n</span> <u>x</u></p>'
    );
  });

  test('typewriter text keeps quotes and dashes as typed', () => {
    assert.strictEqual(
      html("\\texttt{``--''}"),
      '<p><span class="tt">``--\'\'</span></p>'
    );
  });

  test('declarations apply to the rest of their group', () => {
    assert.strictEqual(
      html('a {\\bfseries b \\itshape c} d {\\small e} {\\em f}'),
      '<p>a <span class="bf">b <span class="it">c</span></span> d <span class="size-small">e</span> <em>f</em></p>'
    );
  });

  test('a declaration at paragraph level covers the following paragraphs', () => {
    assert.strictEqual(
      html('a \\bfseries b\n\nc'),
      '<p>a <span class="bf">b</span></p><div class="bf"><p>c</p></div>'
    );
  });

  test('\\verb and verbatim', () => {
    assert.strictEqual(
      html('\\verb|\\x| \\begin{verbatim}\n  a  b\n\\end{verbatim}'),
      '<p><code class="verb">\\x</code></p><pre class="verbatim">  a  b\n</pre>'
    );
  });
});

describe('renderDocument: document structure', () => {
  const doc = String.raw`\documentclass[11pt]{article}
\title{The \emph{Title}}
\author{Ann \and Bob\\Uni}
\date{}
\begin{document}
\maketitle
\section{Intro}
First.

Second.
\subsection*{Aside}
Text.
\subsubsection{Deep}
\paragraph{Run} in.
\section{Next}
\end{document}`;

  test('maketitle, numbered sections and indentation after headings', () => {
    assert.strictEqual(
      html(doc),
      '<header class="maketitle"><div class="title">The <em>Title</em></div>' +
        '<div class="authors"><span class="author">Ann</span><span class="author">Bob<br>Uni</span></div>' +
        '<div class="date"></div></header>' +
        '<h2 class="section"><span class="secnum">1</span>Intro</h2>' +
        '<p class="noindent">First.</p><p>Second.</p>' +
        '<h3 class="subsection">Aside</h3><p class="noindent">Text.</p>' +
        '<h4 class="subsubsection"><span class="secnum">1.0.1</span>Deep</h4>' +
        '<p class="runin"><span class="runin-heading">Run</span>in.</p>' +
        '<h2 class="section"><span class="secnum">2</span>Next</h2>'
    );
  });

  test('the date defaults to \\today', () => {
    assert.match(
      html('\\title{T}\\author{A}\\begin{document}\\maketitle\\end{document}'),
      /<div class="date">October 31, 2026<\/div>/
    );
  });

  test('\\maketitle without \\title is an error, like LaTeX', () => {
    assert.ok(
      codes('\\begin{document}\\maketitle\\end{document}').includes(
        'syntax/no-title'
      )
    );
  });

  test('preamble commands produce no output; text after \\end{document} is ignored', () => {
    assert.strictEqual(
      html(
        '\\documentclass{article}\\usepackage{x}\\begin{document}Hi\\end{document}after'
      ),
      '<p>Hi</p>'
    );
  });

  test('the result exposes geometry and a plain-text title', () => {
    const r = renderDocument(
      '\\documentclass[12pt,a4paper]{article}\\title{A \\textbf{B}}\\begin{document}\\end{document}'
    );
    assert.strictEqual(r.geometry.options.size, 12);
    assert.strictEqual(r.geometry.options.paper, 'a4paper');
    assert.strictEqual(r.title, 'A B');
    assert.strictEqual(r.tree.attrs.class, 'latex-document');
  });

  test('parse and structure diagnostics are included', () => {
    assert.deepStrictEqual(codes('\\documentclass{article}{'), [
      'syntax/unclosed-group',
      'syntax/missing-document',
    ]);
  });

  test('\\newpage, \\label and \\ref', () => {
    // Before any counter, LaTeX's \\@currentlabel is empty: \\ref prints nothing.
    assert.strictEqual(
      html('a\\label{x}\\newpage b \\ref{x}'),
      '<p>a</p><div class="pagebreak"></div><p>b</p>'
    );
    assert.strictEqual(
      html('\\section*{S}\\section{T}\\label{t}\\newpage See \\ref{t}.'),
      '<h2 class="section">S</h2><h2 class="section"><span class="secnum">1</span>T</h2><div class="pagebreak"></div><p>See 1.</p>'
    );
  });
});

describe('renderDocument: lists', () => {
  test('a list after a blank line is in vertical mode (adds \\partopsep)', () => {
    assert.match(
      html('Text.\n\n\\begin{itemize}\\item a\\end{itemize}'),
      /<ul class="itemize vmode">/
    );
  });

  test('itemize with labels; text right after the list continues unindented', () => {
    assert.strictEqual(
      html(
        'Intro:\n\\begin{itemize}\n  \\item one\n  \\item[--] two\n\\end{itemize}\nAfter.\n\nNew.'
      ),
      '<p>Intro:</p><ul class="itemize"><li><p><span class="item-label">•</span>one</p></li>' +
        '<li><p><span class="item-label">–</span>two</p></li></ul>' +
        '<p class="noindent">After.</p><p>New.</p>'
    );
  });

  test('enumerate numbering by depth', () => {
    assert.strictEqual(
      html(
        '\\begin{enumerate}\\item a\\begin{enumerate}\\item b\\item c\\end{enumerate}\\item d\\end{enumerate}'
      ),
      '<ol class="enumerate vmode"><li><p><span class="item-label">1.</span>a</p>' +
        '<ol class="enumerate"><li><p><span class="item-label">(a)</span>b</p></li>' +
        '<li><p><span class="item-label">(b)</span>c</p></li></ol></li>' +
        '<li><p><span class="item-label">2.</span>d</p></li></ol>'
    );
  });

  test('deeper itemize and enumerate labels', () => {
    const nest = (env: string, depth: number): string =>
      depth === 0
        ? 'x'
        : `\\begin{${env}}\\item ${nest(env, depth - 1)}\\end{${env}}`;
    const labels = (src: string) =>
      [...html(src).matchAll(/item-label">([^<]*)</g)].map((m) => m[1]);
    assert.deepStrictEqual(labels(nest('itemize', 4)), ['•', '–', '∗', '·']);
    assert.deepStrictEqual(labels(nest('enumerate', 4)), [
      '1.',
      '(a)',
      'i.',
      'A.',
    ]);
  });

  test('description lists use bold run-in labels', () => {
    assert.strictEqual(
      html('\\begin{description}\\item[Term] text\\end{description}'),
      '<ul class="description vmode"><li><p><span class="item-label">Term</span>text</p></li></ul>'
    );
  });

  test('multi-paragraph items and items starting with a list', () => {
    assert.strictEqual(
      html(
        '\\begin{itemize}\\item a\n\nb\\item\\begin{itemize}\\item c\\end{itemize}\\end{itemize}'
      ),
      '<ul class="itemize vmode"><li><p><span class="item-label">•</span>a</p><p>b</p></li>' +
        '<li><p><span class="item-label">•</span></p><ul class="itemize vmode"><li><p><span class="item-label">–</span>c</p></li></ul></li></ul>'
    );
  });

  test('text before the first \\item warns and is dropped', () => {
    assert.ok(
      codes('\\begin{itemize}oops\\item a\\end{itemize}').includes(
        'syntax/missing-item'
      )
    );
  });
});

describe('renderDocument: environments, notes and math', () => {
  test('center, flushleft, flushright, quote, quotation, abstract', () => {
    assert.strictEqual(
      html(
        '\\begin{center}c\\end{center}\\begin{flushleft}l\\end{flushleft}\\begin{flushright}r\\end{flushright}\\begin{quote}q\\end{quote}\\begin{quotation}qq\\end{quotation}\\begin{abstract}ab\\end{abstract}'
      ),
      '<div class="center vmode"><p>c</p></div><div class="flushleft vmode"><p>l</p></div><div class="flushright vmode"><p>r</p></div>' +
        '<blockquote class="quote vmode"><p>q</p></blockquote><blockquote class="quotation vmode"><p>qq</p></blockquote>' +
        '<div class="abstract"><div class="abstract-title">Abstract</div><div class="abstract-body"><p>ab</p></div></div>'
    );
  });

  test('unknown environments keep their content', () => {
    assert.strictEqual(
      html('\\begin{foo}x\\end{foo}'),
      '<div class="unknown-environment" data-env="foo"><p>x</p></div>'
    );
  });

  test('unknown commands show their mandatory arguments as text', () => {
    assert.strictEqual(html('a \\foo[opt]{b}{c} d'), '<p>a bc d</p>');
  });

  test('footnotes are numbered and collected at the end', () => {
    assert.strictEqual(
      html('a\\footnote{one} b\\footnote[7]{seven}'),
      '<p>a<sup class="footnote-mark">1</sup> b<sup class="footnote-mark">7</sup></p>' +
        '<section class="footnotes"><p><sup class="footnote-mark">1</sup>one</p><p><sup class="footnote-mark">7</sup>seven</p></section>'
    );
  });

  test('math is MathML: inline in the text, displays as grids (math.test.ts has the details)', () => {
    const cell = (x: string) =>
      `<div class="math-row"><div class="math-cell c1"><math displaystyle="true"><mi>${x}</mi></math></div>`;
    assert.strictEqual(
      html(
        'Let $x^2$ be.\n\\[ y \\]\n\\begin{equation}z\\end{equation}\\begin{equation*}w\\end{equation*}'
      ),
      '<p>Let <math><msup><mi>x</mi><mn>2</mn></msup></math> be.</p>' +
        `<div class="math-display cols-1">${cell('y')}</div></div>` +
        `<div class="math-display cols-1">${cell('z')}<span class="eqno">(1)</span></div></div>` +
        `<div class="math-display cols-1">${cell('w')}</div></div>`
    );
  });

  test('misplaced specials print literally; stray \\item is ignored', () => {
    assert.strictEqual(html('a & b \\item c'), '<p>a &amp; b c</p>');
  });

  test('groups render inline', () => {
    assert.strictEqual(html('a{b}c'), '<p>abc</p>');
  });

  test('a declaration directly before a list still applies to it', () => {
    assert.strictEqual(
      html('{\\small\\begin{itemize}\\item x\\end{itemize}}'),
      '<div class="size-small"><ul class="itemize vmode"><li><p><span class="item-label">•</span>x</p></li></ul></div>'
    );
  });
});
