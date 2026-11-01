import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIE_WIDTHS, tieFont } from '../../scripts/make-tie-fonts.ts';
import { FONT_FACES } from './document-css.ts';

test('every face’s tie width has a generated tie font', () => {
  for (const f of FONT_FACES)
    if (f.tie) assert.ok(TIE_WIDTHS.includes(f.tie), `${f.file}: ${f.tie}`);
});

test('the committed tie fonts are what the generator makes', () => {
  for (const w of TIE_WIDTHS) {
    const file = new URL(`../assets/fonts/tie-${w}.ttf`, import.meta.url);
    assert.deepEqual(
      new Uint8Array(readFileSync(file)),
      tieFont(w),
      `tie-${w}`
    );
  }
});

test('a tie font’s U+00A0 advance is the given width, in a 1000-unit em', () => {
  const font = tieFont(333);
  const view = new DataView(font.buffer);
  const tables = new Map<string, number>();
  const lengths = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + 16 * i;
    const tag = String.fromCharCode(...font.slice(at, at + 4));
    tables.set(tag, view.getUint32(at + 8));
    lengths.set(tag, view.getUint32(at + 12));
  }
  assert.equal(view.getUint16(tables.get('head')! + 18), 1000);
  // hmtx: glyph 1 (U+00A0 via cmap) advance.
  assert.equal(view.getUint16(tables.get('hmtx')! + 4), 333);
  // OTS rejects a zero-length glyf table.
  assert.ok(lengths.get('glyf')! > 0);
});
