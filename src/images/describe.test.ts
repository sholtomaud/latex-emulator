import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeImage, includeSnippet } from './describe.ts';

test('describes an image for the explorer', () => {
  assert.equal(
    describeImage(
      { type: 'png', widthPx: 600, heightPx: 300, dpiX: 300, dpiY: 300 },
      1596
    ),
    'PNG · 600 × 300 px · 300 dpi · 1.6 KB'
  );
  assert.equal(
    describeImage({ type: 'jpeg', widthPx: 800, heightPx: 400 }, 2_400_000),
    'JPEG · 800 × 400 px · 2.4 MB'
  );
  assert.equal(
    describeImage({ type: 'pdf', widthBp: 100.4, heightBp: 50 }, 900),
    'PDF · 100 × 50 pt · 900 B'
  );
  assert.equal(describeImage({ type: 'pdf' }, 900), 'PDF · 900 B');
});

test('the snippet that includes an image at the line width', () => {
  assert.equal(
    includeSnippet('figs/plot.png'),
    '\\includegraphics[width=\\linewidth]{figs/plot.png}'
  );
});
