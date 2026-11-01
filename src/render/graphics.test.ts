import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { graphicsBox, parseKeyval } from './graphics.ts';

const ctx = { textwidth: 345, em: 10.96, ex: 4.72 }; // bp
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const box = (
  opts: string,
  natural: { width: number; height: number } | null = {
    width: 200,
    height: 100,
  }
) => graphicsBox(parseKeyval(opts), natural, ctx);

describe('parseKeyval', () => {
  test('splits at top-level commas; values keep their braces’ content', () => {
    assert.deepEqual(
      parseKeyval(' width = 0.5\\linewidth, keepaspectratio ,trim={1 2 3 4}'),
      [
        ['width', '0.5\\linewidth'],
        ['keepaspectratio', null],
        ['trim', '1 2 3 4'],
      ]
    );
    assert.deepEqual(parseKeyval(''), []);
  });
});

describe('graphicsBox (graphicx keys, applied in order)', () => {
  test('natural size; scale', () => {
    assert.deepEqual(box(''), {
      width: 200,
      height: 100,
      rotate: 0,
      problems: [],
      draft: false,
    });
    const b = box('scale=0.5');
    assert.deepEqual([b.width, b.height], [100, 50]);
  });

  test('width or height alone keeps the aspect ratio; both distort', () => {
    const w = box('width=0.5\\linewidth');
    near(w.width, 172.5);
    near(w.height, 86.25);
    const h = box('height=1in');
    near(h.width, 144);
    near(h.height, 72);
    const both = box('width=100bp,height=100bp');
    assert.deepEqual([both.width, both.height], [100, 100]);
    const total = box('totalheight=50bp');
    assert.deepEqual([total.width, total.height], [100, 50]);
  });

  test('keepaspectratio fits inside width × height', () => {
    const b = box('width=100bp,height=100bp,keepaspectratio');
    assert.deepEqual([b.width, b.height], [100, 50]);
    const c = box('keepaspectratio,width=400bp,height=100bp');
    assert.deepEqual([c.width, c.height], [200, 100]);
  });

  test('angle: multiples of 90°; sizes after the angle apply to the rotated box', () => {
    const before = box('angle=90,width=50bp');
    // The rotated box is 100 wide and 200 tall; width=50 halves it.
    assert.deepEqual(
      [before.width, before.height, before.rotate],
      [50, 100, 90]
    );
    // Scaled to 50 × 25 first, then turned: a 25 × 50 box.
    const after = box('width=50bp,angle=-90');
    assert.deepEqual([after.width, after.height, after.rotate], [25, 50, 270]);
    assert.deepEqual(box('angle=30').problems, ['angle=30']);
  });

  test('natwidth/natheight give the size of an image whose size is unknown', () => {
    const b = box('natwidth=300bp,natheight=150bp,width=150bp', null);
    assert.deepEqual([b.width, b.height], [150, 75]);
  });

  test('without a natural size: the requested size, else 1in × 0.75in', () => {
    const none = box('', null);
    assert.deepEqual([none.width, none.height], [72, 54]);
    const w = box('width=200bp', null);
    assert.deepEqual([w.width, w.height], [200, 150]);
  });

  test('draft; unsupported keys and unreadable lengths are reported', () => {
    assert.equal(box('draft').draft, true);
    assert.equal(box('draft=false').draft, false);
    assert.deepEqual(box('trim=1 2 3 4,clip,page=2,width=wide').problems, [
      'trim',
      'clip',
      'page',
      'width=wide',
    ]);
  });
});
