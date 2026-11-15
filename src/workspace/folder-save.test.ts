import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  planFolderSave,
  projectFiles,
  readProject,
  saveProject,
} from './folder-save.ts';
import type { ProjectDirectory } from './folder-save.ts';
import { buildProject } from './project.ts';

const text = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** A folder in memory, counting writes. */
function fakeDir(files: Record<string, string | Uint8Array> = {}) {
  const store = new Map<string, Uint8Array>(
    Object.entries(files).map(([p, v]) => [
      p,
      typeof v === 'string' ? text(v) : v,
    ])
  );
  const writes: string[] = [];
  const dir: ProjectDirectory = {
    name: 'a-short-example',
    async read(path) {
      return store.get(path) ?? null;
    },
    async write(path, bytes) {
      writes.push(path);
      store.set(path, bytes);
    },
    async list() {
      return [...store.keys()];
    },
  };
  return { dir, store, writes };
}

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0, 0, 0, 0, 0,
]);

describe('projectFiles', () => {
  test('the project folder’s files, relative to the folder', () => {
    const project = buildProject({
      name: 'A Short Example',
      source: '\\bibliography{references}',
      bibFiles: { references: '@misc{a,}' },
      images: [{ name: 'figs/plot.png', bytes: PNG }],
    });
    assert.deepEqual(
      projectFiles(project).map((f) => f.path),
      ['a-short-example.tex', 'references.bib', 'figs/plot.png']
    );
  });

  test('the .tex keeps the name the folder already uses', () => {
    const project = buildProject({
      name: 'Renamed',
      source: 'x',
      bibFiles: {},
      images: [],
    });
    assert.deepEqual(
      projectFiles(project, 'paper.tex').map((f) => f.path),
      ['paper.tex']
    );
  });
});

describe('planFolderSave', () => {
  const H = { a: 'aa', b: 'bb', c: 'cc' };
  test('new files are written, identical ones skipped', () => {
    assert.deepEqual(
      planFolderSave(
        { 'x.tex': H.a, 'y.bib': H.b },
        { 'x.tex': null, 'y.bib': H.b },
        {}
      ),
      { write: ['x.tex'], same: ['y.bib'], conflicts: [] }
    );
  });

  test('a file changed in the folder since the last save is a conflict', () => {
    assert.deepEqual(
      planFolderSave({ 'x.tex': H.c }, { 'x.tex': H.b }, { 'x.tex': H.a }),
      { write: [], same: [], conflicts: ['x.tex'] }
    );
    // Unchanged there since our save: ours replaces it.
    assert.deepEqual(
      planFolderSave({ 'x.tex': H.c }, { 'x.tex': H.a }, { 'x.tex': H.a }),
      { write: ['x.tex'], same: [], conflicts: [] }
    );
    // A different file we never wrote is a conflict too (first save into
    // a folder that already has a project of that name).
    assert.deepEqual(planFolderSave({ 'x.tex': H.c }, { 'x.tex': H.b }, {}), {
      write: [],
      same: [],
      conflicts: ['x.tex'],
    });
    // Deleted there: written again.
    assert.deepEqual(
      planFolderSave({ 'x.tex': H.c }, { 'x.tex': null }, { 'x.tex': H.a }),
      { write: ['x.tex'], same: [], conflicts: [] }
    );
  });
});

describe('saveProject', () => {
  const files = [
    { path: 'paper.tex', bytes: text('v1') },
    { path: 'figs/plot.png', bytes: PNG },
  ];

  test('writes everything the first time and records what it wrote', async () => {
    const { dir, store, writes } = fakeDir();
    const r = await saveProject(dir, files, {});
    assert.ok(r.ok);
    assert.deepEqual(writes, ['paper.tex', 'figs/plot.png']);
    assert.deepEqual(r.written, ['paper.tex', 'figs/plot.png']);
    assert.deepEqual(r.saved, {
      'paper.tex': sha(text('v1')),
      'figs/plot.png': sha(PNG),
    });
    assert.equal(new TextDecoder().decode(store.get('paper.tex')), 'v1');
  });

  test('later saves write only what changed', async () => {
    const { dir, writes } = fakeDir();
    const first = await saveProject(dir, files, {});
    assert.ok(first.ok);
    writes.length = 0;
    const r = await saveProject(
      dir,
      [{ path: 'paper.tex', bytes: text('v2') }, files[1]],
      first.saved
    );
    assert.ok(r.ok);
    assert.deepEqual(writes, ['paper.tex']);
  });

  test('a conflict writes nothing unless told to overwrite', async () => {
    const { dir, store, writes } = fakeDir();
    const first = await saveProject(dir, files, {});
    assert.ok(first.ok);
    store.set('paper.tex', text('edited in another editor'));
    writes.length = 0;
    const next = [{ path: 'paper.tex', bytes: text('v2') }, files[1]];
    const r = await saveProject(dir, next, first.saved);
    assert.deepEqual(r, { ok: false, conflicts: ['paper.tex'] });
    assert.deepEqual(writes, []);
    const forced = await saveProject(dir, next, first.saved, {
      overwrite: true,
    });
    assert.ok(forced.ok);
    assert.equal(new TextDecoder().decode(store.get('paper.tex')), 'v2');
  });

  test('files no longer in the project are left alone', async () => {
    const { dir, store } = fakeDir();
    const first = await saveProject(dir, files, {});
    assert.ok(first.ok);
    const r = await saveProject(dir, [files[0]], first.saved);
    assert.ok(r.ok);
    assert.ok(store.has('figs/plot.png'));
    assert.deepEqual(Object.keys(r.saved), ['paper.tex', 'figs/plot.png']);
  });
});

describe('readProject', () => {
  const SOURCE = String.raw`\documentclass{article}
\graphicspath{{figs/}}
\begin{document}
\includegraphics{plot}
\includegraphics{missing}
\bibliography{references,extra}
\end{document}`;

  test('reads the .tex, the .bib files it lists and the images it uses', async () => {
    const { dir } = fakeDir({
      'a-short-example.tex': SOURCE,
      'a-short-example.pdf': '%PDF-1.5 compiled output',
      'a-short-example.aux': 'aux',
      'references.bib': '@misc{a,}',
      'unrelated.bib': '@misc{b,}',
      'figs/plot.png': PNG,
      'figs/other.png': PNG,
    });
    const r = await readProject(dir);
    assert.ok(r.ok);
    assert.equal(r.project.name, 'a short example');
    assert.equal(r.project.texPath, 'a-short-example.tex');
    assert.equal(r.project.source, SOURCE);
    assert.deepEqual(r.project.bibFiles, [
      { name: 'references', source: '@misc{a,}' },
    ]);
    assert.deepEqual(
      r.project.images.map((i) => i.name),
      ['figs/plot.png']
    );
    assert.deepEqual(r.project.missing, ['extra.bib', 'missing']);
    // What was read becomes the baseline for the next save.
    assert.deepEqual(Object.keys(r.project.saved).sort(), [
      'a-short-example.tex',
      'figs/plot.png',
      'references.bib',
    ]);
  });

  test('with several .tex files, the one named after the folder wins, then the one with \\begin{document}', async () => {
    const named = await readProject(
      fakeDir({
        'chapter.tex': '\\begin{document}x\\end{document}',
        'a-short-example.tex': 'main',
      }).dir
    );
    assert.ok(named.ok);
    assert.equal(named.project.texPath, 'a-short-example.tex');
    const main = await readProject(
      fakeDir({
        'macros.tex': '\\newcommand{\\x}{y}',
        'paper.tex': '\\begin{document}x\\end{document}',
      }).dir
    );
    assert.ok(main.ok);
    assert.equal(main.project.texPath, 'paper.tex');
    assert.equal(main.project.name, 'paper');
  });

  test('a folder with no .tex file at its top is refused', async () => {
    const r = await readProject(fakeDir({ 'sub/x.tex': 'x' }).dir);
    assert.deepEqual(r, {
      ok: false,
      message: 'That folder has no .tex file at its top level.',
    });
  });
});
