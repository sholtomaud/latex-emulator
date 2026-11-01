import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from './render-document.ts';
import type { RenderOptions } from './render-document.ts';
import { serialize } from './hnode.ts';

const doc = (body: string, preamble = '') =>
  `\\documentclass{article}\\usepackage{graphicx}${preamble}\\begin{document}${body}\\end{document}`;
const images: RenderOptions['images'] = {
  'plot.png': {
    url: 'blob:https://x/1',
    info: { type: 'png', widthPx: 288, heightPx: 144, dpiX: 144, dpiY: 144 },
  },
  'figs/map.jpg': {
    url: 'blob:https://x/2',
    info: { type: 'jpeg', widthPx: 100, heightPx: 50 },
  },
  'scan.pdf': {
    url: 'blob:https://x/3',
    info: { type: 'pdf', widthBp: 50, heightBp: 20 },
  },
};
const render = (body: string, preamble = '') =>
  renderDocument(doc(body, preamble), { images });
const html = (body: string, preamble = '') =>
  render(body, preamble).tree.children.map(serialize).join('');
const codes = (body: string, preamble = '') =>
  render(body, preamble).diagnostics.map((d) => [d.code, d.severity]);

describe('\\includegraphics', () => {
  test('a stored PNG at pdfTeX’s natural size (pixels / dpi)', () => {
    assert.equal(
      html('\\includegraphics{plot}'),
      '<p><img class="graphic" src="blob:https://x/1" alt="plot.png" style="width: 144pt; height: 72pt"></p>'
    );
    assert.deepEqual(codes('\\includegraphics{plot}'), []);
  });

  test('options size it; \\graphicspath finds folders', () => {
    assert.match(
      html('\\includegraphics[width=72bp]{map}', '\\graphicspath{{figs/}}'),
      /src="blob:https:\/\/x\/2" alt="figs\/map\.jpg" style="width: 72pt; height: 36pt"/
    );
  });

  test('a quarter turn: the box is the rotated size', () => {
    assert.match(
      html('\\includegraphics[angle=90]{plot}'),
      /<span class="graphic-box rot-90" style="width: 72pt; height: 144pt"><img class="graphic" src="blob:https:\/\/x\/1" alt="plot\.png" style="width: 144pt; height: 72pt"><\/span>/
    );
  });

  test('a missing image is an error, shown as a framed box with its name', () => {
    assert.equal(
      html('\\includegraphics[width=2in]{nope}'),
      '<p><span class="graphic placeholder" style="width: 144pt; height: 108pt">nope</span></p>'
    );
    assert.deepEqual(codes('\\includegraphics{nope}'), [
      ['ref/missing-image', 'error'],
    ]);
    const d = render('\\includegraphics{nope}').diagnostics[0];
    assert.match(d.message, /“nope”.*Images/);
  });

  test('PDF figures and draft are placeholders; only the PDF says why', () => {
    assert.match(
      html('\\includegraphics{scan}'),
      /<span class="graphic placeholder" style="width: 50pt; height: 20pt">scan\.pdf<\/span>/
    );
    assert.deepEqual(codes('\\includegraphics{scan}'), [
      ['render/pdf-image', 'info'],
    ]);
    assert.match(
      html('\\includegraphics[draft]{plot}'),
      /placeholder.*plot\.png/
    );
    assert.deepEqual(codes('\\includegraphics[draft]{plot}'), []);
  });

  test('unsupported keys warn and are ignored', () => {
    assert.deepEqual(codes('\\includegraphics[trim=1 2 3 4,clip]{plot}'), [
      ['syntax/unsupported-graphics-option', 'warning'],
    ]);
    assert.match(
      render('\\includegraphics[trim=1 2 3 4,clip]{plot}').diagnostics[0]
        .message,
      /trim, clip/
    );
  });
});

describe('paragraph-level declarations', () => {
  test('\\centering before text centres the paragraphs that follow', () => {
    assert.equal(
      html('{\\centering Middle.\\par More.\\par}'),
      '<div class="centering"><p>Middle.</p><p>More.</p></div>'
    );
  });
});

describe('figure', () => {
  test('numbered separately from tables, with \\label and \\ref', () => {
    const out = html(
      'See Figure~\\ref{f}.\\begin{figure}[h]\\centering\\includegraphics{plot}\\caption{A plot.}\\label{f}\\end{figure}'
    );
    assert.match(
      out,
      /^<p>See Figure\u00a01\.<\/p><div class="float figure"><div class="centering"><p><img /
    );
    assert.match(
      out,
      /<p class="caption"><span class="caption-label">Figure\u00a01: <\/span>A plot\.<\/p>/
    );
  });
});
