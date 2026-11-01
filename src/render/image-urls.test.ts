import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImageUrls } from './image-urls.ts';

const info = { type: 'png', widthPx: 1, heightPx: 1 } as const;
const file = (sha: string, name: string) => ({
  meta: { name, sha256: sha },
  file: { blob: new Blob([sha]), info },
});
const state = (...fs: ReturnType<typeof file>[]) => ({
  images: fs.map((f) => f.meta),
  files: Object.fromEntries(fs.map((f) => [f.meta.name, f.file])),
});

test('one URL per distinct image; revoked when no name uses it', () => {
  let n = 0;
  const revoked: string[] = [];
  const urls = new ImageUrls(
    () => `blob:u${++n}`,
    (u) => revoked.push(u)
  );
  const a = urls.update(state(file('s1', 'a.png'), file('s1', 'copy.png')));
  assert.deepEqual(a, {
    'a.png': { url: 'blob:u1', info },
    'copy.png': { url: 'blob:u1', info },
  });
  const b = urls.update(state(file('s1', 'renamed.png'), file('s2', 'b.png')));
  assert.equal(b['renamed.png'].url, 'blob:u1');
  assert.equal(b['b.png'].url, 'blob:u2');
  assert.deepEqual(revoked, []);
  urls.update(state(file('s2', 'b.png')));
  assert.deepEqual(revoked, ['blob:u1']);
  urls.clear();
  assert.deepEqual(revoked, ['blob:u1', 'blob:u2']);
});

test('by default, real blob: URLs', () => {
  const urls = new ImageUrls();
  const out = urls.update(state(file('s1', 'a.png')));
  assert.match(out['a.png'].url, /^blob:/);
  urls.clear();
});
