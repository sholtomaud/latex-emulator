import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { listingLines, ot1Roman } from './listings.ts';
import { serialize } from './hnode.ts';
import { DEFAULT_LST, applyLstOptions } from '../latex/listings/options.ts';
import { LANGUAGES } from '../latex/listings/languages.ts';

const settings = (opts = '') => applyLstOptions(DEFAULT_LST, opts, new Map());
const html = (code: string, opts = '') => {
  const s = settings(opts);
  return listingLines(code, s, s.language ? LANGUAGES[s.language] : null, 1)
    .lines.map(serialize)
    .join('\n');
};

describe('ot1Roman (listings in a roman font: OT1 cmr glyphs)', () => {
  test('characters listings maps to text commands, and cmr’s own quirks', () => {
    assert.equal(ot1Roman('"a" - b*c'), '”a” − b∗c');
    assert.equal(ot1Roman("'x'`y"), '’x’‘y');
    assert.equal(ot1Roman('a^b~c'), 'aˆb˜c');
    assert.equal(ot1Roman('<>{}|\\_$'), '<>{}|\\_$');
  });
});

describe('listingLines: fixed columns (listings’ default)', () => {
  test('each unit is n × 0.6em; characters spread evenly inside', () => {
    assert.equal(
      html('x = f(y)\n'),
      '<p class="lst-line">' +
        '<span class="lst-u" style="width: 0.6em">x</span>' +
        '<span class="lst-sp" style="width: 0.6em"></span>' +
        '<span class="lst-u" style="width: 0.6em">=</span>' +
        '<span class="lst-sp" style="width: 0.6em"></span>' +
        '<span class="lst-u" style="width: 0.6em">f</span>' +
        '<span class="lst-u" style="width: 0.6em">(</span>' +
        '<span class="lst-u" style="width: 0.6em">y</span>' +
        '<span class="lst-u" style="width: 0.6em">)</span>' +
        '</p>'
    );
    assert.match(
      html('def'),
      /<span class="lst-u" style="width: 1.8em"><span>d<\/span><span>e<\/span><span>f<\/span><\/span>/
    );
  });

  test('styles become font classes; tt has no bold in OT1 (cmtt), as in pdflatex', () => {
    assert.match(
      html('for x', 'language=Python'),
      /<span class="lst-u bf" style="width: 1.8em">/
    );
    assert.match(
      html('for x', 'language=Python, basicstyle=\\ttfamily'),
      /<span class="lst-u" style="width: 1.8em"><span>f/
    );
    assert.match(
      html('# hi', 'language=Python, commentstyle=\\itshape'),
      /<span class="lst-u it" style="width: 0.6em">#<\/span>/
    );
  });

  test('visible spaces in strings; roman glyphs only outside \\ttfamily', () => {
    assert.match(
      html('"a b"', 'language=Python'),
      /<span class="lst-u" style="width: 0.6em"><span class="lst-vs"><\/span><\/span>/
    );
    assert.match(html('"a"', 'language=Python'), /”/);
    assert.match(
      html('"a"', 'language=Python, basicstyle=\\ttfamily'),
      /<span class="lst-u" style="width: 0.6em">&quot;<\/span>/
    );
  });

  test('empty lines keep their height; numbers by stepnumber', () => {
    const r = listingLines(
      'a\n\nb\n',
      settings('numbers=left, stepnumber=2'),
      null,
      1
    );
    assert.equal(r.next, 4);
    assert.deepEqual(r.lines.map(serialize), [
      '<p class="lst-line"><span class="lst-u" style="width: 0.6em">a</span></p>',
      '<p class="lst-line"><span class="lst-num">2</span></p>',
      '<p class="lst-line"><span class="lst-u" style="width: 0.6em">b</span></p>',
    ]);
  });

  test('numbers=right; columns=[l]fixed', () => {
    assert.match(
      html('a', 'numbers=right'),
      /<span class="lst-num right">1<\/span>/
    );
    assert.match(
      html('ab', 'columns=[l]fixed'),
      /<span class="lst-u l" style="width: 1.2em">/
    );
  });
});

describe('listingLines: flexible columns', () => {
  test('fullflexible: natural widths; a space run is one font space, indentation keeps basewidth columns', () => {
    assert.equal(
      html('  x =  1', 'columns=fullflexible'),
      '<p class="lst-line"><span class="lst-sp" style="width: 0.9em"></span>' +
        '<span class="lst-f">x</span> <span class="lst-f">=</span> <span class="lst-f">1</span></p>'
    );
  });

  test('flexible in \\ttfamily: units of 0.525em keep listings’ lost-space grid', () => {
    // "x" (0.525em) loses 0.075em against 0.45em; the first space is a font
    // space unit (0.525em, another −0.075em); the second space adds 0.45em:
    // 0.3em is kerned before "=" (listings.sty, \lst@CalcLostSpaceAndOutput).
    assert.equal(
      html('x  =', 'columns=flexible, basicstyle=\\ttfamily'),
      '<p class="lst-line"><span class="lst-f">x</span> ' +
        '<span class="lst-sp" style="width: 0.3em"></span><span class="lst-f">=</span></p>'
    );
  });
});
