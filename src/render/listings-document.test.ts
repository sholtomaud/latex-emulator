import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from './render-document.ts';
import { serialize } from './hnode.ts';
import { LANGUAGES } from '../latex/listings/languages.ts';

const doc = (body: string, preamble = '') =>
  `\\documentclass{article}\\usepackage{listings}${preamble}\\begin{document}${body}\\end{document}`;
const render = (body: string, preamble = '') =>
  renderDocument(doc(body, preamble), { lstLanguages: LANGUAGES });
const html = (body: string, preamble = '') =>
  render(body, preamble).tree.children.map(serialize).join('');
const codes = (body: string, preamble = '') =>
  render(body, preamble).diagnostics.map((d) => [d.code, d.severity]);

describe('lstlisting in a document', () => {
  test('a block of lines in the basic style, after the paragraph', () => {
    const out = html(
      'Before.\n\\begin{lstlisting}\nx\n\\end{lstlisting}\nAfter.'
    );
    assert.match(
      out,
      /^<p>Before\.<\/p><div class="lstlisting"><div class="lst-code"><p class="lst-line"><span class="lst-u" style="width: 0\.6em">x<\/span><\/p><\/div><\/div><p class="noindent">After\.<\/p>$/
    );
    assert.deepEqual(codes('\\begin{lstlisting}\nx\n\\end{lstlisting}'), []);
  });

  test('\\lstset and \\lstdefinestyle apply in order, preamble first', () => {
    const out = html(
      '\\begin{lstlisting}[style=s]\nfor\n\\end{lstlisting}\\lstset{basicstyle=\\small}\\begin{lstlisting}\nx\n\\end{lstlisting}',
      '\\lstset{language=Python}\\lstdefinestyle{s}{basicstyle=\\ttfamily}'
    );
    assert.match(
      out,
      /<div class="lst-code tt"><p class="lst-line"><span class="lst-u" style="width: 1\.8em">/
    );
    assert.match(out, /<div class="lst-code size-small">/);
  });

  test('captions number listings; labels and \\ref; title is unnumbered', () => {
    const out = html(
      'See~\\ref{l}.\\begin{lstlisting}[caption={A \\emph{loop}.},label=l]\nx\n\\end{lstlisting}\\begin{lstlisting}[title=Plain]\ny\n\\end{lstlisting}\\begin{lstlisting}[caption=Two,captionpos=b]\nz\n\\end{lstlisting}'
    );
    assert.match(out, /^<p>See\u00a01\.<\/p>/);
    assert.match(
      out,
      /<div class="lstlisting"><p class="caption lst-caption"><span class="caption-label">Listing\u00a01: <\/span>A <em>loop<\/em>\.<\/p><div class="lst-code">/
    );
    assert.match(out, /<p class="caption lst-caption">Plain<\/p>/);
    assert.match(
      out,
      /<div class="lst-code">.*?z.*?<\/div><p class="caption lst-caption below"><span class="caption-label">Listing\u00a02: <\/span>Two<\/p>/
    );
  });

  test('numbers, frames and margins go on the block', () => {
    assert.match(
      html(
        '\\begin{lstlisting}[numbers=left,numbersep=5pt,frame=single,xleftmargin=10pt]\nx\n\\end{lstlisting}'
      ),
      /<div class="lstlisting" style="margin-left: 9\.9626pt; --lst-numbersep: 4\.9813pt; --lst-framesep: 2\.9888pt; --lst-framerule: 0\.3985pt"><div class="lst-code frame-single">/
    );
  });

  test('\\lstinline is inline, in the current settings', () => {
    assert.match(
      html('Call \\lstinline[language=Python]|print(x)| now.'),
      /^<p>Call <span class="lstinline"><span class="lst-u bf" style="width: 3em">/
    );
  });

  test('unsupported options, unknown languages and missing data warn', () => {
    assert.deepEqual(
      codes(
        '\\begin{lstlisting}[escapeinside=||,language=Cobol2]\nx\n\\end{lstlisting}'
      ),
      [
        ['syntax/unsupported-listings-option', 'warning'],
        ['syntax/unknown-listings-language', 'warning'],
      ]
    );
    const r = render(
      '\\begin{lstlisting}[language=Cobol2]\nx\n\\end{lstlisting}'
    );
    assert.match(r.diagnostics[0].message, /language=Cobol2/);
  });
});
