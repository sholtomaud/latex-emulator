import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  injectPrecache,
  precacheManifest,
  PRECACHE_MARKER,
} from './precache.ts';

const file = (path: string, text = path) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

describe('precacheManifest', () => {
  test('lists every file the app needs, sorted, without the worker itself or Pages extras', async () => {
    const m = await precacheManifest([
      file('index.html'),
      file('assets/monaco-abc.js'),
      file('assets/lmroman10-regular-x.woff2'),
      file('sw.js'),
      file('404.html'),
      file('.nojekyll'),
      file('manifest.webmanifest'),
    ]);
    assert.deepEqual(m.files, [
      './',
      'assets/lmroman10-regular-x.woff2',
      'assets/monaco-abc.js',
      'index.html',
      'manifest.webmanifest',
    ]);
    assert.match(m.version, /^[0-9a-f]{16}$/);
  });

  test('the version changes when any file changes, and only then', async () => {
    const a = await precacheManifest([file('index.html', 'v1'), file('a.js')]);
    const b = await precacheManifest([file('a.js'), file('index.html', 'v1')]);
    const c = await precacheManifest([file('index.html', 'v2'), file('a.js')]);
    assert.equal(a.version, b.version);
    assert.notEqual(a.version, c.version);
  });
});

describe('injectPrecache', () => {
  test('replaces the marker in the worker with the manifest', () => {
    const sw = `const PRECACHE = ${PRECACHE_MARKER};\nself.x = 1;`;
    const out = injectPrecache(sw, { version: 'abc', files: ['./', 'a.js'] });
    assert.equal(
      out,
      'const PRECACHE = {"version":"abc","files":["./","a.js"]};\nself.x = 1;'
    );
  });

  test('a worker without the marker is an error, not a silent no-op', () => {
    assert.throws(
      () => injectPrecache('self.x = 1;', { version: 'a', files: [] }),
      /marker/
    );
  });
});
