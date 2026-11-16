import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { documentFiles } from './explorer-tree.ts';

const LIBRARY = {
  references:
    '@book{a, title={A}}\n@book{b, title={B}}\n@book{C, title={C}}\n@book{d, title={D}}',
  extra: '@misc{x, title={X}}',
};

describe('documentFiles (ADR 0022)', () => {
  test('the .tex, then each listed .bib with how many of its entries are cited', () => {
    const source = [
      '\\begin{document}',
      '\\citet{a} and \\citep{c,zzz}.',
      '\\bibliography{references,extra,missing}',
      '\\end{document}',
    ].join('\n');
    assert.deepEqual(documentFiles('A Short Example', source, LIBRARY), {
      tex: 'a-short-example.tex',
      bibs: [
        { file: 'references.bib', cited: 2, total: 4, inLibrary: true },
        { file: 'extra.bib', cited: 0, total: 1, inLibrary: true },
        { file: 'missing.bib', cited: 0, total: 0, inLibrary: false },
      ],
    });
  });

  test('\\nocite{*} cites a whole file; no \\bibliography lists nothing', () => {
    assert.deepEqual(
      documentFiles('x', '\\nocite{*}\\bibliography{references}', LIBRARY).bibs,
      [{ file: 'references.bib', cited: 4, total: 4, inLibrary: true }]
    );
    assert.deepEqual(documentFiles('x', 'Hello.', LIBRARY).bibs, []);
  });
});
