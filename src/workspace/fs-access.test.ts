import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { directoryOf, permission } from './fs-access.ts';
import { FakeDir } from '../test-support/fake-directory.ts';

const text = (s: string) => new TextEncoder().encode(s);

describe('directoryOf', () => {
  test('writes files and their folders, reads them back, lists them', async () => {
    const root = new FakeDir('paper');
    const dir = directoryOf(root);
    assert.equal(dir.name, 'paper');
    await dir.write('paper.tex', text('hello'));
    await dir.write('figs/sub/plot.png', text('png'));
    assert.equal(
      new TextDecoder().decode((await dir.read('paper.tex'))!),
      'hello'
    );
    assert.equal(await dir.read('nope.tex'), null);
    assert.equal(await dir.read('nope/x.tex'), null);
    assert.equal(await dir.read('figs'), null);
    assert.deepEqual((await dir.list()).sort(), [
      'figs/sub/plot.png',
      'paper.tex',
    ]);
  });

  test('listing skips hidden folders and stops at a depth and a count', async () => {
    const root = new FakeDir('p');
    const dir = directoryOf(root, { maxDepth: 2, maxFiles: 3 });
    await dir.write('.git/config', text('x'));
    await dir.write('a/b/c/deep.png', text('x'));
    await dir.write('a/b/ok.png', text('x'));
    for (const n of ['1', '2', '3', '4']) await dir.write(`${n}.tex`, text(n));
    const listed = await dir.list();
    assert.equal(listed.length, 3);
    assert.ok(!listed.some((p) => p.startsWith('.git') || p.includes('deep')));
  });

  test('refuses unsafe paths', async () => {
    const dir = directoryOf(new FakeDir('p'));
    await assert.rejects(dir.write('../x.tex', text('x')), /path/);
    await assert.rejects(dir.write('/x.tex', text('x')), /path/);
    assert.equal(await dir.read('a/../x'), null);
  });
});

describe('permission', () => {
  test('asks only when it must, and only when allowed to', async () => {
    const root = new FakeDir('p');
    assert.equal(await permission(root, false), 'granted');
    root.state = 'prompt';
    assert.equal(await permission(root, false), 'prompt');
    assert.equal(root.asked, 0);
    assert.equal(await permission(root, true), 'granted');
    assert.equal(root.asked, 1);
  });
});
