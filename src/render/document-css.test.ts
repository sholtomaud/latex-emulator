import { describe, test } from 'node:test';
import assert from 'node:assert';
import { articleGeometry, toBp } from '../latex/classes/article.ts';
import {
  FONT_ASCENT,
  FONT_FACES,
  fontFaceCss,
  geometryCss,
  preprintCss,
} from './document-css.ts';

const g11 = articleGeometry({ size: 11, paper: 'a4paper' });
const varValue = (css: string, name: string) => {
  const m = css.match(new RegExp(`${name}: (-?[\\d.]+)pt;`));
  assert.ok(m, `${name} not found`);
  return Number(m[1]);
};

describe('geometryCss', () => {
  const css = geometryCss(g11);

  test('sets @page size and margins from the class geometry (in CSS pt)', () => {
    const m = css.match(
      /@page \{\s*size: ([\d.]+)pt ([\d.]+)pt;\s*margin: ([\d.]+)pt ([\d.]+)pt ([\d.]+)pt ([\d.]+)pt;/
    );
    assert.ok(m, 'no @page rule');
    const [, w, hgt, top, right, bottom, left] = m.map(Number);
    assert.ok(Math.abs(w - 595.28) < 0.01);
    assert.ok(Math.abs(hgt - 841.89) < 0.01);
    assert.ok(Math.abs(left - toBp(g11.textLeft)) < 0.01);
    assert.ok(Math.abs(left + toBp(g11.textWidth) + right - w) < 0.01);
    assert.ok(Math.abs(top - toBp(g11.textTop)) < 0.01);
    assert.ok(Math.abs(top + toBp(g11.textHeight) + bottom - hgt) < 0.01);
  });

  test('exposes type sizes and skips as custom properties', () => {
    assert.ok(Math.abs(varValue(css, '--fs') - toBp(10.95)) < 0.001);
    assert.ok(Math.abs(varValue(css, '--lh') - toBp(13.6)) < 0.001);
    assert.ok(Math.abs(varValue(css, '--parindent') - toBp(17)) < 0.001);
    assert.ok(Math.abs(varValue(css, '--fs-LARGE') - toBp(17.28)) < 0.001);
    // 3.5ex of the normal font (cmr ex = 0.430555 em).
    assert.ok(
      Math.abs(
        varValue(css, '--section-before') - toBp(3.5 * 0.430555 * 10.95)
      ) < 0.001
    );
  });

  test('the first baseline sits \\topskip below the top of the text block', () => {
    // First line box: baseline at half-leading + ascent; we offset the text block so that is \topskip.
    const lh = toBp(13.6);
    const fs = toBp(10.95);
    const baselineInLine = (lh - fs) / 2 + FONT_ASCENT * fs;
    // Blocks carry margin-top b = lh - baselineInLine, so the first baseline is at offset + lh.
    assert.ok(
      Math.abs(varValue(css, '--first-line-offset') + lh - toBp(11)) < 0.001
    );
    assert.ok(baselineInLine > 0);
  });
});

test('the title starts 2em + \\baselineskip below the \\null line at \\topskip', () => {
  const css = geometryCss(g11);
  assert.ok(
    Math.abs(varValue(css, '--title-before') - toBp(2 * 10.95 + 13.6)) < 0.001
  );
});

describe('fontFaceCss', () => {
  test('a tie (U+00A0) is as wide as each face’s space, from a tie font after the face', () => {
    const urls: Record<string, string> = Object.fromEntries(
      FONT_FACES.map((f) => [f.file, `/x/${f.file}.woff2`])
    );
    for (const w of [302, 326, 333, 350, 358, 367, 375, 378, 383, 414])
      urls[`tie-${w}`] = `/x/tie-${w}.ttf`;
    const css = fontFaceCss(urls);
    assert.match(
      css,
      /src: url\("\/x\/lmroman10-regular\.woff2"\) format\('woff2'\); \}\n@font-face \{ font-family: 'LM Roman 10'; font-weight: 400; font-style: normal; [^}]*unicode-range: U\+00A0; src: url\("\/x\/tie-333\.ttf"\) format\('truetype'\); \}/
    );
    assert.match(
      css,
      /font-family: 'LM Roman 10'; font-weight: 700; font-style: normal; [^}]*unicode-range: U\+00A0; src: url\("\/x\/tie-383\.ttf"\)/
    );
    // LM Mono's no-break space is already as wide as its space.
    assert.doesNotMatch(css, /LM Mono 10[^}]*unicode-range/);
  });

  test('declares every face with metric overrides and the given URLs', () => {
    const urls = Object.fromEntries(
      FONT_FACES.map((f) => [f.file, `/x/${f.file}.woff2`])
    );
    const css = fontFaceCss(urls);
    // No tie font URLs given, so no tie faces.
    assert.strictEqual(css.match(/@font-face/g)?.length, FONT_FACES.length);
    assert.match(
      css,
      /font-family: 'LM Roman 10';[^}]*font-weight: 700;[^}]*font-style: italic;[^}]*url\("\/x\/lmroman10-bolditalic\.woff2"\)/
    );
    assert.match(
      css,
      /ascent-override: 80\.6%; descent-override: 19\.4%; line-gap-override: 0%;/
    );
  });

  test('a missing URL omits that face rather than emitting a broken rule', () => {
    assert.strictEqual(fontFaceCss({}), '');
  });
});

describe('preprintCss', () => {
  const stamp = {
    version: '0.1.1',
    date: new Date(2026, 9, 31).getTime(),
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  };

  test('puts version, date and short hash in the footer margin boxes', () => {
    const css = preprintCss(stamp, g11);
    assert.match(
      css,
      /@bottom-left \{[^}]*content: "Preprint · v0\.1\.1 · October 31, 2026"/
    );
    assert.match(
      css,
      /@bottom-right \{[^}]*content: "SHA-256 ba7816bf8f01cfea"/
    );
  });

  test('sits on the same baseline as the page number', () => {
    const page = geometryCss(g11).match(
      /@bottom-center \{[^}]*padding-top: ([\d.]+)pt/
    )![1];
    const css = preprintCss(stamp, g11);
    for (const box of ['bottom-left', 'bottom-right']) {
      const m = css.match(
        new RegExp(`@${box} \\{[^}]*padding-top: ([\\d.]+)pt`)
      );
      assert.ok(m, box);
      // Footnotesize text, same baseline: padding differs only by the smaller ascent.
      assert.ok(Number(m[1]) > Number(page));
    }
  });

  test('escapes anything that could break out of a CSS string', () => {
    const css = preprintCss({ ...stamp, version: '1"} body{x' }, g11);
    assert.ok(!css.includes('1"}'));
    assert.match(css, /v1\\"\} body\{x/);
  });
});
