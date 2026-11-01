import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parse } from '../parser/parser.ts';
import { analyzeDocument, plainText } from './structure.ts';
import type { Node } from '../ast/nodes.ts';

const text = (nodes: Node[] | undefined) =>
  (nodes ?? [])
    .map((n) => (n.kind === 'text' ? n.value : n.kind === 'space' ? ' ' : ''))
    .join('');

const analyze = (src: string) => analyzeDocument(parse(src).root);

describe('analyzeDocument', () => {
  const full = String.raw`\documentclass[12pt, letterpaper]{article}
\usepackage{amsmath}
\title{My Title}
\author{A. Author}
\date{Today}
\begin{document}
Body
\end{document}
ignored`;

  test('reads the document class and its options', () => {
    const doc = analyze(full);
    assert.strictEqual(doc.documentClass?.name, 'article');
    assert.deepStrictEqual(doc.documentClass?.options, ['12pt', 'letterpaper']);
  });

  test('lists packages', () => {
    assert.deepStrictEqual(analyze(full).packages, ['amsmath']);
  });

  test('collects title, author and date', () => {
    const doc = analyze(full);
    assert.strictEqual(text(doc.metadata.title), 'My Title');
    assert.strictEqual(text(doc.metadata.author), 'A. Author');
    assert.strictEqual(text(doc.metadata.date), 'Today');
  });

  test('the body is the document environment’s content', () => {
    const doc = analyze(full);
    assert.strictEqual(doc.hasDocumentEnvironment, true);
    assert.strictEqual(text(doc.body).trim(), 'Body');
  });

  test('a fragment with no preamble is all body', () => {
    const doc = analyze('Just text');
    assert.strictEqual(doc.documentClass, undefined);
    assert.strictEqual(doc.hasDocumentEnvironment, false);
    assert.strictEqual(text(doc.body), 'Just text');
    assert.deepStrictEqual(doc.diagnostics, []);
  });

  test('a \\documentclass without a document environment is an error', () => {
    const doc = analyze('\\documentclass{article}\nText');
    assert.strictEqual(doc.diagnostics[0].code, 'syntax/missing-document');
    assert.strictEqual(text(doc.body).trim(), 'Text');
  });

  test('\\title in the body (before \\maketitle) also counts', () => {
    const doc = analyze(
      '\\begin{document}\\title{Late}\\maketitle\\end{document}'
    );
    assert.strictEqual(text(doc.metadata.title), 'Late');
  });

  test('unsupported document classes warn', () => {
    const doc = analyze(
      '\\documentclass{memoir}\\begin{document}\\end{document}'
    );
    assert.strictEqual(doc.diagnostics[0].code, 'syntax/unsupported-class');
    assert.strictEqual(doc.diagnostics[0].severity, 'warning');
  });

  test('no class options gives an empty list', () => {
    assert.deepStrictEqual(
      analyze('\\documentclass{article}\\begin{document}\\end{document}')
        .documentClass?.options,
      []
    );
  });

  test('plainText includes the text inside formatting commands', () => {
    const doc = analyze('\\title{A \\textbf{B} \\LaTeX}');
    assert.strictEqual(plainText(doc.metadata.title ?? []), 'A B ');
  });

  test('\\graphicspath lists directories in order; none by default', () => {
    assert.deepStrictEqual(
      analyze(
        '\\graphicspath{{figs/}{./img/}}\\begin{document}x\\end{document}'
      ).graphicsPath,
      ['figs/', './img/']
    );
    assert.deepStrictEqual(analyze('x').graphicsPath, []);
    // Directories must each be in braces, as graphicx reads them.
    assert.deepStrictEqual(analyze('\\graphicspath{figs/}').graphicsPath, []);
    // Without \\begin{document}, it is still preamble, not body text.
    const loose = analyze('\\documentclass{article}\\graphicspath{{a/}}Hello');
    assert.deepStrictEqual(
      loose.body
        .filter((n) => n.kind === 'command')
        .map((n) => n.kind === 'command' && n.name),
      []
    );
  });
});
