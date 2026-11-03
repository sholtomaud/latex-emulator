import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from './render-document.ts';
import { serialize } from './hnode.ts';

const doc = (body: string, options = '') =>
  `\\documentclass{article}\\usepackage{algorithm}\\usepackage${options}{algpseudocode}\\begin{document}${body}\\end{document}`;
const render = (body: string, options = '') =>
  renderDocument(doc(body, options));
const html = (body: string, options = '') =>
  render(body, options).tree.children.map(serialize).join('');
const codes = (body: string) =>
  render(body).diagnostics.map((d) => [d.code, d.severity]);

const alg = (body: string, opt = '') =>
  `\\begin{algorithmic}${opt}\n${body}\n\\end{algorithmic}`;

describe('algorithmic lines (algpseudocode)', () => {
  test('a line per statement, keywords bold, depth as a custom property; the first line’s height, the last one’s depth', () => {
    assert.equal(
      html(alg('\\While{$r$}\n\\State x\n\\EndWhile')),
      '<div class="algorithmic" style="--alg-h: 0.6944em; --alg-d: 0em">' +
        '<div class="alg-line"><span class="alg-text"><span class="bf">while</span> <math><mi>r</mi></math> <span class="bf">do</span></span></div>' +
        '<div class="alg-line" style="--alg-depth: 1"><span class="alg-text">x</span></div>' +
        '<div class="alg-line"><span class="alg-text"><span class="bf">end</span> <span class="bf">while</span></span></div>' +
        '</div>'
    );
    assert.deepEqual(codes(alg('\\State x')), []);
  });

  test('[1] numbers lines (footnotesize "n:"); Require/Ensure hang a bold label', () => {
    const out = html(alg('\\Require $n$\n\\State x', '[1]'));
    assert.match(
      out,
      /^<div class="algorithmic numbered" style="--alg-h: 0\.6944em; --alg-d: 0em"><div class="alg-line"><span class="alg-label bf" style="width: 4\.2749em">Require:<\/span><span class="alg-text"><math><mi>n<\/mi><\/math><\/span><\/div><div class="alg-line"><span class="alg-num"><span class="size-footnotesize">1:<\/span><\/span><span class="alg-text">x<\/span><\/div><\/div>$/
    );
  });

  test('\\Comment is set flush right after ▷; \\Procedure, \\Call, \\Return', () => {
    const out = html(
      alg(
        '\\Procedure{Euclid}{$a$}\\Comment{the gcd}\n\\State \\Return \\Call{Gcd}{$b$}\n\\State \\Call{Stop}{}\n\\EndProcedure'
      )
    );
    assert.match(
      out,
      /<span class="alg-text"><span class="bf">procedure<\/span> <span class="sc">Euclid<\/span>\(<math><mi>a<\/mi><\/math>\)<\/span><span class="alg-comment"><math><mo lspace="0" rspace="0">▷<\/mo><\/math> the gcd<\/span>/
    );
    assert.match(
      out,
      /<span class="alg-text"><span class="bf">return<\/span> <span class="sc">Gcd<\/span>\(<math><mi>b<\/mi><\/math>\)<\/span>/
    );
    assert.match(
      out,
      /<span class="alg-text"><span class="sc">Stop<\/span><\/span>/
    );
  });

  test('the noend package option drops the closing lines', () => {
    const out = html(alg('\\If{c}\n\\State x\n\\EndIf'), '[noend]');
    assert.doesNotMatch(out, /end/);
  });

  test('unbalanced blocks are errors at the command', () => {
    assert.deepEqual(codes(alg('\\State x\n\\EndIf')), [
      ['syntax/unbalanced-algorithmic', 'error'],
    ]);
  });

  test('\\label in a line refers to its line number', () => {
    const out = html(
      `${alg('\\State a\n\\State b\\label{l:b}', '[1]')}Line~\\ref{l:b}.`
    );
    assert.match(out, /<p class="noindent">Line\u00a02\.<\/p>$/);
  });
});

describe('the algorithm float (float.sty, ruled)', () => {
  test('[H] (float.sty) is marked on any float: its spacing differs from [h]', () => {
    assert.match(
      html('\\begin{table}[H]\\caption{T}\\end{table}'),
      /^<div class="float table H">/
    );
    assert.match(
      html('\\begin{figure}[ht]\\caption{F}\\end{figure}'),
      /^<div class="float figure">/
    );
  });

  test('"Algorithm n" in bold, no colon; the caption first wherever it is written', () => {
    const out = html(
      `\\begin{algorithm}[H]${alg('\\State x')}\\caption{Euclid’s}\\label{a:e}\\end{algorithm}See~\\ref{a:e}.`
    );
    assert.match(
      out,
      /^<div class="float algorithm H" style="--cap-h: 0\.6944em; --cap-d: 0\.1944em"><p class="caption alg-caption"><span class="caption-label bf" style="width: 6\.1345em">Algorithm\u00a01<\/span> Euclid’s<\/p><div class="algorithmic"/
    );
    assert.match(out, /<p class="noindent">See\u00a01\.<\/p>$/);
  });

  test('its own counter, beside tables and figures', () => {
    const out = html(
      '\\begin{table}\\caption{T}\\end{table}\\begin{algorithm}\\caption{A}\\end{algorithm}\\begin{algorithm}\\caption{B}\\end{algorithm}'
    );
    assert.match(out, /Table\u00a01: /);
    assert.match(out, /Algorithm\u00a01<\/span> A/);
    assert.match(out, /Algorithm\u00a02<\/span> B/);
  });

  test('without a caption: no caption rule', () => {
    assert.match(
      html(`\\begin{algorithm}${alg('\\State x')}\\end{algorithm}`),
      /^<div class="float algorithm nocaption"><div class="algorithmic"/
    );
  });
});
