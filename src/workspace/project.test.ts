import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProject } from './project.ts';

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 4, 5]);

const SOURCE = [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\begin{document}',
  '\\includegraphics{plots/energy}',
  '\\bibliographystyle{plainnat}',
  '\\bibliography{references, extra.bib}',
  '\\end{document}',
].join('\n');

describe('buildProject', () => {
  test('the .tex, the .bib files it lists and its images, in a folder named after the document', () => {
    const project = buildProject({
      name: 'A Short Example',
      source: SOURCE,
      bibFiles: {
        references: '@book{a, title={A}}',
        extra: '@book{b, title={B}}',
        unused: '@book{c, title={C}}',
      },
      images: [
        { name: 'plots/energy.png', bytes: png },
        { name: 'bucket.jpg', bytes: jpg },
      ],
    });
    assert.strictEqual(project.folder, 'a-short-example');
    assert.strictEqual(project.fileName, 'a-short-example.zip');
    assert.deepStrictEqual(
      project.files.map((f) => f.path),
      [
        'a-short-example/a-short-example.tex',
        'a-short-example/references.bib',
        'a-short-example/extra.bib',
        // Next to the .tex, at the names \includegraphics uses (ADR 0013).
        'a-short-example/bucket.jpg',
        'a-short-example/plots/energy.png',
      ]
    );
    assert.strictEqual(decode(project.files[0].bytes), SOURCE);
    assert.strictEqual(decode(project.files[1].bytes), '@book{a, title={A}}');
    assert.deepStrictEqual(project.files[4].bytes, png);
    assert.deepStrictEqual(project.missingBibs, []);
  });

  test('reports listed .bib files the library does not have', () => {
    const project = buildProject({
      name: 'Paper',
      source: SOURCE,
      bibFiles: { references: '' },
      images: [],
    });
    assert.deepStrictEqual(
      project.files.map((f) => f.path),
      ['paper/paper.tex', 'paper/references.bib']
    );
    assert.deepStrictEqual(project.missingBibs, ['extra']);
  });

  test('a file listed twice is written once', () => {
    const project = buildProject({
      name: 'Paper',
      source: '\\begin{document}\\bibliography{refs,refs.bib}\\end{document}',
      bibFiles: { refs: 'x' },
      images: [],
    });
    assert.deepStrictEqual(
      project.files.map((f) => f.path),
      ['paper/paper.tex', 'paper/refs.bib']
    );
  });

  test('no \\bibliography: just the .tex and the images', () => {
    const project = buildProject({
      name: 'Untitled',
      source: 'Hello',
      bibFiles: { references: 'x' },
      images: [{ name: 'a.png', bytes: png }],
    });
    assert.deepStrictEqual(
      project.files.map((f) => f.path),
      ['untitled/untitled.tex', 'untitled/a.png']
    );
  });

  test('a .bib name that could escape the folder is reported, not written', () => {
    const project = buildProject({
      name: 'Paper',
      source: '\\begin{document}\\bibliography{../secret}\\end{document}',
      bibFiles: { '../secret': 'x' },
      images: [],
    });
    assert.deepStrictEqual(
      project.files.map((f) => f.path),
      ['paper/paper.tex']
    );
    assert.deepStrictEqual(project.missingBibs, ['../secret']);
  });
});
