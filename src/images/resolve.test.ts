import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGraphic, GRAPHICS_EXTENSIONS } from './resolve.ts';

describe('resolveGraphic (graphicx + pdftex.def)', () => {
  const names = [
    'plot.png',
    'plot.pdf',
    'figs/map.jpg',
    'photo.JPG',
    'a.b.png',
  ];

  test('an explicit extension must match exactly', () => {
    assert.equal(resolveGraphic('plot.png', names), 'plot.png');
    assert.equal(resolveGraphic('photo.JPG', names), 'photo.JPG');
    assert.equal(resolveGraphic('photo.jpg', names), null);
    assert.equal(resolveGraphic('a.b.png', names), 'a.b.png');
  });

  test('no extension: \\DeclareGraphicsExtensions order (.pdf before .png)', () => {
    assert.equal(resolveGraphic('plot', names), 'plot.pdf');
    assert.equal(resolveGraphic('photo', names), 'photo.JPG');
    assert.equal(resolveGraphic('a.b', names), 'a.b.png');
    assert.equal(resolveGraphic('nothing', names), null);
    assert.deepEqual(GRAPHICS_EXTENSIONS.slice(0, 5), [
      '.pdf',
      '.png',
      '.jpg',
      '.mps',
      '.jpeg',
    ]);
  });

  test('the document folder first, then each \\graphicspath directory', () => {
    assert.equal(resolveGraphic('figs/map', names), 'figs/map.jpg');
    assert.equal(
      resolveGraphic('map', names, ['other/', 'figs/']),
      'figs/map.jpg'
    );
    assert.equal(resolveGraphic('./plot.png', names), 'plot.png');
    // A directory without its trailing slash still works.
    assert.equal(resolveGraphic('map', names, ['figs']), 'figs/map.jpg');
  });
});
