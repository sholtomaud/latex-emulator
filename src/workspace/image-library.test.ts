import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ImageLibrary, imageName, uniqueName } from './image-library.ts';
import type { ImageLibraryState } from './image-library.ts';
import { MemoryRepository } from '../storage/memory-repository.ts';

const u32 = (n: number) => [
  n >>> 24,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
/** A minimal PNG header of w × h pixels; `salt` makes distinct bytes. */
const png = (w: number, h: number, salt = 0) =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    73,
    72,
    68,
    82,
    ...u32(w),
    ...u32(h),
    8,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u32(1),
    73,
    68,
    65,
    84,
    salt,
    0,
    0,
    0,
    0,
  ]);
const pdf = Uint8Array.from(
  [...'%PDF-1.4 /MediaBox [0 0 100 50]'].map((c) => c.charCodeAt(0))
);

function setup(repo = new MemoryRepository()) {
  let clock = 100;
  const states: ImageLibraryState[] = [];
  const library = new ImageLibrary(repo, {
    now: () => ++clock,
    publish: (s) => states.push(s),
  });
  return { repo, library, last: () => states.at(-1)! };
}

describe('imageName', () => {
  test('a file name LaTeX can use, with the extension of what the file is', () => {
    assert.equal(imageName('Energy plot (2).png', 'png'), 'Energy-plot-2.png');
    assert.equal(imageName('photo.JPEG', 'jpeg'), 'photo.jpeg');
    assert.equal(imageName('photo.jpg', 'jpeg'), 'photo.jpg');
    // A PNG named .jpg: pdfTeX picks the reader by extension, so fix it.
    assert.equal(imageName('wrong.jpg', 'png'), 'wrong.png');
    assert.equal(imageName('C:\\figs\\map.pdf', 'pdf'), 'map.pdf');
    assert.equal(imageName('noext', 'jpeg'), 'noext.jpg');
    assert.equal(imageName(null, 'png'), 'pasted-image.png');
    assert.equal(imageName('.png', 'png'), 'image.png');
  });

  test('uniqueName numbers a clash', () => {
    assert.equal(uniqueName('fig.png', new Set()), 'fig.png');
    assert.equal(
      uniqueName('fig.png', new Set(['fig.png', 'fig-2.png'])),
      'fig-3.png'
    );
  });
});

describe('ImageLibrary', () => {
  test('adds images to the open document, with size and natural size', async () => {
    const { library, last } = setup();
    await library.init();
    await library.open('d1');
    const r = await library.add('plot.png', png(144, 72));
    assert.deepEqual(r, { ok: true, name: 'plot.png' });
    const [meta] = last().images;
    assert.equal(meta.name, 'plot.png');
    assert.equal(meta.type, 'png');
    assert.deepEqual(meta.naturalBp, { width: 144, height: 72 });
    assert.equal(meta.bytes, png(144, 72).length);
    assert.equal(last().documentId, 'd1');
    assert.ok(last().files['plot.png'].blob instanceof Blob);
  });

  test('refuses what pdflatex can’t include, and nothing is open', async () => {
    const { library } = setup();
    await library.init();
    assert.deepEqual(await library.add('x.png', png(1, 1)), {
      ok: false,
      message: 'Open a document first.',
    });
    await library.open('d1');
    const gif = Uint8Array.from([71, 73, 70, 56, 57, 97]);
    const r = await library.add('anim.gif', gif);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.message : '', /anim\.gif.*PNG, JPEG or PDF/);
  });

  test('the same name in a document gets a number; the same bytes are kept once', async () => {
    const { library, repo, last } = setup();
    await library.init();
    await library.open('d1');
    await library.add('fig.png', png(2, 2, 1));
    assert.deepEqual(await library.add('fig.png', png(2, 2, 2)), {
      ok: true,
      name: 'fig-2.png',
    });
    // Identical bytes already here: no new entry.
    assert.deepEqual(await library.add('again.png', png(2, 2, 1)), {
      ok: true,
      name: 'fig.png',
      existing: true,
    });
    assert.deepEqual(
      last().images.map((i) => i.name),
      ['fig-2.png', 'fig.png']
    );
    // Another document may use the same name: folders are per document.
    await library.open('d2');
    assert.deepEqual(await library.add('fig.png', png(2, 2, 1)), {
      ok: true,
      name: 'fig.png',
    });
    const entries = await repo.listImages();
    assert.equal(entries.length, 3);
    assert.equal(new Set(entries.map((e) => e.sha256)).size, 2);
  });

  test('images elsewhere can be reused without copying', async () => {
    const { library, repo, last } = setup();
    await library.init();
    await library.open('d1');
    await library.add('map.pdf', pdf);
    await library.open('d2');
    // A different PDF with the same name.
    await library.add('map.pdf', Uint8Array.from([...pdf, 32]));
    const [other] = last().elsewhere;
    assert.equal(other.documentId, 'd1');
    assert.equal(other.name, 'map.pdf');
    assert.deepEqual(await library.reuse(other.id), {
      ok: true,
      name: 'map-2.pdf',
    });
    assert.deepEqual(last().elsewhere, []);
    assert.deepEqual(
      last().images.find((i) => i.name === 'map-2.pdf')?.naturalBp,
      {
        width: 100,
        height: 50,
      }
    );
    assert.equal(
      new Set((await repo.listImages()).map((e) => e.sha256)).size,
      2
    );
    assert.deepEqual(await library.reuse('nope'), {
      ok: false,
      message: 'That image is gone.',
    });
  });

  test('rename keeps the type’s extension and refuses clashes and odd paths', async () => {
    const { library, last } = setup();
    await library.init();
    await library.open('d1');
    await library.add('a.png', png(1, 1, 1));
    await library.add('b.png', png(1, 1, 2));
    assert.deepEqual(await library.rename('a.png', 'figs/energy'), {
      ok: true,
      name: 'figs/energy.png',
    });
    assert.deepEqual(
      last().images.map((i) => i.name),
      ['b.png', 'figs/energy.png']
    );
    assert.equal((await library.rename('b.png', 'figs/energy.png')).ok, false);
    assert.equal((await library.rename('b.png', '../x.png')).ok, false);
    assert.equal((await library.rename('b.png', '/abs.png')).ok, false);
    assert.equal((await library.rename('b.png', 'sp ace.png')).ok, false);
    assert.equal((await library.rename('zzz.png', 'y.png')).ok, false);
    assert.deepEqual(await library.rename('b.png', 'b.png'), {
      ok: true,
      name: 'b.png',
    });
  });

  test('delete, and deleting a document’s images, drop unused blobs', async () => {
    const { library, repo, last } = setup();
    await library.init();
    await library.open('d1');
    await library.add('a.png', png(1, 1, 1));
    await library.add('b.png', png(1, 1, 2));
    await library.open('d2');
    await library.add('a.png', png(1, 1, 1));
    await library.open('d1');
    await library.delete('b.png');
    await library.delete('b.png');
    assert.deepEqual(
      last().images.map((i) => i.name),
      ['a.png']
    );
    await library.deleteDocument('d1');
    assert.deepEqual(last().images, []);
    const left = await repo.listImages();
    assert.deepEqual(
      left.map((e) => e.id),
      ['d2/a.png']
    );
    assert.ok(await repo.getImageBlob(left[0].sha256));
  });

  test('init reads stored entries; file() gives a download', async () => {
    const repo = new MemoryRepository();
    const first = setup(repo);
    await first.library.init();
    await first.library.open('d1');
    await first.library.add('a.png', png(1, 1));
    const second = setup(repo);
    await second.library.init();
    await second.library.open('d1');
    assert.deepEqual(
      second.last().images.map((i) => i.name),
      ['a.png']
    );
    assert.equal(second.library.file('a.png')?.fileName, 'a.png');
    assert.equal(second.library.file('nope'), null);
  });
});
