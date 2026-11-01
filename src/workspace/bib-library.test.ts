import { describe, test } from 'node:test';
import assert from 'node:assert';
import { BibLibrary, bibName } from './bib-library.ts';
import type { BibLibraryState } from './bib-library.ts';
import { MemoryRepository } from '../storage/memory-repository.ts';

const ODUM =
  '@book{odum_energy_1996, author = {Howard T. Odum}, title = {E}, year = 1996}';
const TWO = `${ODUM}\n@misc{x_y_2020, title = {Y}}`;

function setup(repo = new MemoryRepository()) {
  let clock = 100;
  const states: BibLibraryState[] = [];
  const library = new BibLibrary(repo, {
    now: () => ++clock,
    publish: (s) => states.push(s),
  });
  return { repo, library, last: () => states.at(-1)! };
}

describe('bibName', () => {
  test('is the file name LaTeX would use in \\bibliography{…}', () => {
    assert.strictEqual(bibName('refs.bib'), 'refs');
    assert.strictEqual(bibName('C:\\papers\\My Library.bib'), 'My-Library');
    assert.strictEqual(bibName('zotero export (1).BIB'), 'zotero-export-1');
    assert.strictEqual(bibName('.bib'), 'references');
  });
});

describe('BibLibrary', () => {
  test('starts empty, or with the seed on first run', async () => {
    const empty = setup();
    await empty.library.init();
    assert.deepStrictEqual(empty.last(), { files: [], sources: {} });

    const seeded = setup();
    await seeded.library.init({ name: 'references', source: TWO });
    assert.deepStrictEqual(seeded.last().files, [
      { name: 'references', entries: 2, updatedAt: 101 },
    ]);
    assert.strictEqual(seeded.last().sources.references, TWO);
  });

  test('the seed never replaces existing files', async () => {
    const repo = new MemoryRepository();
    await repo.putBibFile({ name: 'mine', source: ODUM, updatedAt: 1 });
    const { library, last } = setup(repo);
    await library.init({ name: 'references', source: TWO });
    assert.deepStrictEqual(Object.keys(last().sources), ['mine']);
  });

  test('importing a file adds it, sorted by name, and reports entries and problems', async () => {
    const { library, last, repo } = setup();
    await library.init();
    const result = await library.importFile('zeta.bib', ODUM);
    assert.deepStrictEqual(result, { name: 'zeta', entries: 1, warnings: [] });
    const bad = await library.importFile(
      'alpha.bib',
      '@book{k, title = {T}, year = unknownmacro}'
    );
    assert.strictEqual(bad.entries, 1);
    assert.strictEqual(bad.warnings.length, 1);
    assert.deepStrictEqual(
      last().files.map((f) => f.name),
      ['alpha', 'zeta']
    );
    assert.strictEqual((await repo.listBibFiles()).length, 2);
  });

  test('importing a file with an existing name replaces it', async () => {
    const { library, last } = setup();
    await library.init();
    await library.importFile('refs.bib', ODUM);
    await library.importFile('refs.bib', TWO);
    assert.strictEqual(last().files.length, 1);
    assert.strictEqual(last().files[0].entries, 2);
    assert.strictEqual(last().sources.refs, TWO);
  });

  test('delete and export', async () => {
    const { library, last } = setup();
    await library.init();
    await library.importFile('refs.bib', ODUM);
    assert.deepStrictEqual(library.exportFile('refs'), {
      fileName: 'refs.bib',
      text: ODUM,
    });
    assert.strictEqual(library.exportFile('nope'), null);
    await library.delete('refs');
    await library.delete('nope');
    assert.deepStrictEqual(last().files, []);
  });
});
