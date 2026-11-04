import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from './render-document.ts';
import { serialize } from './hnode.ts';

const FRONT = String.raw`\begin{frontmatter}
\title{Energy flows}
\author[a]{Ada Lovelace\corref{cor1}}
\ead{ada@example.org}
\author[a,b]{Howard Odum}
\cortext[cor1]{Corresponding author}
\address[a]{Dept A}
\address[b]{Inst B}
\begin{abstract}
We measure.
\end{abstract}
\begin{keyword}
emergy \sep estuary
\end{keyword}
\end{frontmatter}`;

const doc = (body: string, opts = 'preprint,12pt', preamble = '') =>
  `\\documentclass[${opts}]{elsarticle}\\journal{Ecological Modelling}\\date{4 November 2026}${preamble}\\begin{document}${body}\\end{document}`;
const render = (body: string, opts?: string, preamble?: string) =>
  renderDocument(doc(body, opts, preamble), {});
const html = (body: string, opts?: string, preamble?: string) =>
  serialize(render(body, opts, preamble).tree);

describe('elsarticle (ADR 0018)', () => {
  test('is a supported class: no warning, its own geometry and document class', () => {
    const r = render('Text.');
    assert.deepEqual(r.diagnostics, []);
    assert.equal(r.geometry.options.size, 12);
    // elsarticle never declares a4paper: article's letter paper stays.
    assert.equal(r.geometry.options.paper, 'letterpaper');
    assert.match(
      serialize(r.tree),
      /^<article class="latex-document elsarticle">/
    );
  });

  test('the frontmatter is the title block, as \\pprintMaketitle sets it', () => {
    const out = html(FRONT);
    assert.match(
      out,
      /<header class="els-frontmatter"><div class="els-title">Energy flows<\/div>/
    );
    assert.match(
      out,
      /<div class="els-authors"><span class="author">Ada Lovelace<sup>a,∗<\/sup><\/span>, <span class="author">Howard Odum<sup>a,b<\/sup><\/span><\/div>/
    );
    assert.match(
      out,
      /<div class="els-addresses"><p><sup>a<\/sup>Dept A<\/p><p><sup>b<\/sup>Inst B<\/p><\/div>/
    );
    assert.match(
      out,
      /<div class="els-abstract"><p class="els-abstract-title">Abstract<\/p><p class="noindent">We measure\.<\/p><\/div>/
    );
    assert.match(
      out,
      /<p class="els-keywords"><span class="it">Keywords:\u00a0<\/span> emergy, estuary<\/p>/
    );
  });

  test('title-page notes become the first footnotes', () => {
    const out = html(FRONT + 'Body.\\footnote{Later.}');
    assert.match(
      out,
      /<section class="footnotes"><p><sup class="footnote-mark">∗<\/sup>Corresponding author<\/p><p class="els-email"><span class="it">Email address: <\/span><span class="tt">ada@example\.org<\/span> \(Ada Lovelace\)<\/p><p><sup class="footnote-mark">1<\/sup>Later\.<\/p><\/section>/
    );
  });

  test('section numbers end with a dot; \\ref has none', () => {
    const out = html(
      '\\section{Intro}\\label{s}\\subsection{Site}See~\\ref{s}.'
    );
    assert.match(
      out,
      /<h2 class="section"><span class="secnum">1\.<\/span>Intro<\/h2>/
    );
    assert.match(
      out,
      /<h3 class="subsection"><span class="secnum">1\.1\.<\/span>Site<\/h3>/
    );
    assert.match(out, /See 1\./);
  });

  test('the first page footer: "Preprint submitted to" the journal, and the date', () => {
    assert.deepEqual(render('x').firstPageFooter, {
      left: 'Preprint submitted to Ecological Modelling',
      right: '4 November 2026',
    });
    const plain = renderDocument(
      '\\documentclass{elsarticle}\\begin{document}x\\end{document}',
      { today: new Date(2026, 10, 4) }
    );
    assert.deepEqual(plain.firstPageFooter, {
      left: 'Preprint submitted to Elsevier',
      right: 'November 4, 2026',
    });
    assert.equal(
      renderDocument(
        '\\documentclass{article}\\begin{document}x\\end{document}'
      ).firstPageFooter,
      undefined
    );
  });

  test('natbib comes with the class: numbers, or authoryear', () => {
    const bib =
      '\\begin{thebibliography}{1}\\bibitem[Odum(1983)]{o} H. T. Odum.\\end{thebibliography}';
    assert.match(html(`\\citep{o}${bib}`), /\[1\]/);
    assert.match(
      html(`\\citep{o}${bib}`, 'preprint,authoryear'),
      /\(Odum, 1983\)/
    );
  });
});
