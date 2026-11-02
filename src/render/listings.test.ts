import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineListing, listingLines, ot1Roman } from './listings.ts';
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
  test('each unit is n × 0.6em; \\hss shares the spare width (CM widths)', () => {
    // x is 0.5278em: (0.6 − 0.5278)/2 on each side; = (0.7778em) overflows.
    assert.equal(
      html('x = f(y)\n'),
      '<p class="lst-line">' +
        '<span class="lst-u" style="width: 0.6em"><span style="margin-left: 0.0361em">x</span></span>' +
        '<span class="lst-sp" style="width: 0.6em"></span>' +
        '<span class="lst-u" style="width: 0.6em"><span style="margin-left: -0.0889em">=</span></span>' +
        '<span class="lst-sp" style="width: 0.6em"></span>' +
        '<span class="lst-u" style="width: 0.6em"><span style="margin-left: 0.1472em">f</span></span>' +
        '<span class="lst-u" style="width: 0.6em"><span style="margin-left: 0.1055em">(</span></span>' +
        '<span class="lst-u" style="width: 0.6em"><span style="margin-left: 0.0361em">y</span></span>' +
        '<span class="lst-u" style="width: 0.6em"><span style="margin-left: 0.1055em">)</span></span>' +
        '</p>'
    );
    // d e f: 1.3056em in 1.8em, four equal gaps.
    assert.match(
      html('def'),
      /width: 1.8em"><span style="margin-left: 0.1236em">d<\/span><span style="margin-left: 0.1236em">e<\/span>/
    );
  });

  test('styles become font classes; tt has no bold in OT1 (cmtt), as in pdflatex', () => {
    assert.match(
      html('for x', 'language=Python'),
      /<span class="lst-u bf" style="width: 1.8em">/
    );
    assert.match(
      html('for x', 'language=Python, basicstyle=\\ttfamily'),
      // 3 × 0.6 × cmtt's quad 1.05
      /<span class="lst-u" style="width: 1.89em"><span style="margin-left: 0.0787em">f/
    );
    assert.match(
      html('# hi', 'language=Python, commentstyle=\\itshape'),
      /<span class="lst-u it" style="width: 0.6em"><span style="margin-left: -?[\d.]+em">#<\/span>/
    );
  });

  test('visible spaces in strings; roman glyphs only outside \\ttfamily', () => {
    assert.match(
      html('"a b"', 'language=Python'),
      /<span class="lst-u" style="width: 0.6em"><span style="margin-left: [\d.]+em"><span class="lst-vs"><\/span><\/span><\/span>/
    );
    assert.match(html('"a"', 'language=Python'), /”/);
    assert.match(
      html('"a"', 'language=Python, basicstyle=\\ttfamily'),
      /<span class="lst-u" style="width: 0.63em"><span style="margin-left: 0.0525em">&quot;<\/span>/
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
      '<p class="lst-line"><span class="lst-u" style="width: 0.6em"><span style="margin-left: 0.05em">a</span></span></p>',
      '<p class="lst-line"><span class="lst-num">2</span></p>',
      '<p class="lst-line"><span class="lst-u" style="width: 0.6em"><span style="margin-left: 0.0222em">b</span></span></p>',
    ]);
  });

  test('numbers=right; columns=[l]fixed', () => {
    assert.match(
      html('a', 'numbers=right'),
      /<span class="lst-num right">1<\/span>/
    );
    assert.match(
      html('ab', 'columns=[l]fixed'),
      /<span class="lst-u" style="width: 1.2em"><span>a<\/span><span style="margin-left: 0.0722em">b<\/span>/
    );
  });
});

describe('basewidth is in the basic font’s quad (TeX’s em)', () => {
  test('cmtt’s quad is 1.05em, cmbx’s 1.15em', () => {
    assert.match(html('ab', 'basicstyle=\\ttfamily'), /style="width: 1\.26em"/);
    assert.match(html('ab', 'basicstyle=\\bfseries'), /style="width: 1\.38em"/);
  });
});

describe('inlineListing', () => {
  test('\\lstinline sets flexiblecolumns: natural widths and listings’ lost space', () => {
    // cmr: x is 0.5278em, the space 0.3333em, = 0.7778em; basewidth 0.45em.
    // After x: −0.0778; the space unit: +0.1167 → 0.0389em kerned before =.
    assert.equal(
      serialize(inlineListing('x = f', settings(), null)),
      '<span class="lstinline"><span class="lst-f">x</span> ' +
        '<span class="lst-sp" style="width: 0.0389em"></span><span class="lst-f">=</span> ' +
        '<span class="lst-f">f</span></span>'
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
    // basewidth 0.45 × cmtt's quad 1.05 = 0.4725em. "x" (0.525em) loses
    // 0.0525em; the first space is a font space unit (0.525em, another
    // −0.0525em); the second space adds 0.4725em: 0.3675em is kerned before
    // "=" (listings.sty, \lst@CalcLostSpaceAndOutput).
    assert.equal(
      html('x  =', 'columns=flexible, basicstyle=\\ttfamily'),
      '<p class="lst-line"><span class="lst-f">x</span> ' +
        '<span class="lst-sp" style="width: 0.3675em"></span><span class="lst-f">=</span></p>'
    );
  });
});

describe('fonts, glyph widths and flexible details', () => {
  const width = (code: string, opts: string) => {
    const m = /margin-left: (-?[\d.]+)em/.exec(html(code, opts));
    return m ? Number(m[1]) : 0;
  };

  test('each family/series/shape uses its own CM metrics', () => {
    // A single "m" centred in 0.6em × quad: different widths, different margins.
    const margins = [
      '',
      'basicstyle=\\sffamily',
      'basicstyle=\\slshape',
      'basicstyle=\\itshape',
      'basicstyle=\\bfseries\\itshape',
    ].map((o) => width('m', o));
    // cmsl10 has cmr10's advance widths; the others differ.
    assert.equal(margins[2], margins[0]);
    assert.equal(new Set(margins).size, 4);
  });

  test('roman substitutes (−, ∗) and characters outside ASCII', () => {
    // \textminus is 0.7778em wide: it overflows the 0.6em column.
    assert.equal(width('-', ''), -0.0889);
    assert.equal(width('é', ''), 0.05);
  });

  test('directives use keywordstyle; keyword classes without a style use the first', () => {
    const s = settings('language=C');
    const out = listingLines('#include x', s, LANGUAGES[s.language!], 1)
      .lines.map(serialize)
      .join('');
    assert.match(out, /<span class="lst-u bf" style="width: 0.6em">/);
    assert.match(html('range', 'language=Python'), /lst-u bf/);
    assert.match(
      html('#include x', 'language=C, directivestyle=\\itshape'),
      /lst-u it/
    );
  });

  test('flexible columns show visible spaces; \\lstinline keeps fullflexible', () => {
    assert.match(html('"a b"', 'language=Python, columns=flexible'), /lst-vs/);
    const s = settings('columns=fullflexible');
    assert.equal(
      serialize(inlineListing('a  b', s, null)),
      '<span class="lstinline"><span class="lst-f">a</span> <span class="lst-f">b</span></span>'
    );
  });
});
