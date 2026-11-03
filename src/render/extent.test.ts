import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from './hnode.ts';
import { boxExtent, textWidth } from './extent.ts';

/** Height and depth rounded to 4 places, as the TFMs give them. */
const ext = (...args: Parameters<typeof boxExtent>) => {
  const { height, depth } = boxExtent(...args);
  return [Number(height.toFixed(4)), Number(depth.toFixed(4))];
};
const math = (...children: ReturnType<typeof h>[]) => h('math', {}, children);

describe('boxExtent: a line’s height and depth, as TeX’s hbox has them', () => {
  // Expected values are pdflatex's \showlists boxes for fixtures/algorithm-basic
  // (11pt: divide by 10.95 for em).
  test('roman text: ascenders and descenders (cmr10)', () => {
    // "Algorithm 1 Euclid’s algorithm": hbox(7.60416+2.12917).
    assert.deepEqual(
      ext([h('span', { class: 'bf' }, ['Algorithm 1']), ' Euclid’s algorithm']),
      [0.6944, 0.1944]
    );
    assert.deepEqual(ext(['end function']), [0.6944, 0]);
    assert.deepEqual(ext(['acorn']), [0.4306, 0]);
    assert.deepEqual(ext(['(x)']), [0.75, 0.25]);
  });

  test('bold and small caps use their own fonts (cmbx10, cmcsc10)', () => {
    assert.deepEqual(ext([h('span', { class: 'bf' }, ['R'])]), [0.6861, 0]);
    assert.deepEqual(ext([h('span', { class: 'sc' }, ['P'])]), [0.6833, 0]);
    assert.deepEqual(ext([h('span', { class: 'sc' }, ['o'])]), [0.5139, 0]);
  });

  test('math: letters in cmmi, digits and brackets in cmr, symbols in cmsy', () => {
    // "procedure Euclid(a, b)": hbox(8.2125+2.73749).
    assert.deepEqual(
      ext([
        h('span', { class: 'bf' }, ['procedure']),
        ' ',
        h('span', { class: 'sc' }, ['Euclid']),
        '(',
        math(h('mi', {}, ['a']), h('mo', {}, [',']), h('mi', {}, ['b'])),
        ')',
      ]),
      [0.75, 0.25]
    );
    assert.deepEqual(ext([math(h('mi', {}, ['x']))]), [0.4306, 0]);
    assert.deepEqual(
      ext([math(h('mi', {}, ['a']), h('mo', {}, ['≥']), h('mn', {}, ['0']))]),
      [0.6444, 0.136]
    );
    // \ne is \not=: the slash reaches 0.694 and 0.194.
    assert.deepEqual(ext([math(h('mo', {}, ['≠']))]), [0.6944, 0.1944]);
    assert.deepEqual(ext([math(h('mo', {}, ['←']))]), [0.3669, 0]);
    assert.deepEqual(ext([math(h('mo', {}, ['mod']))]), [0.6944, 0]);
  });

  test('scripts: 0.7 size, \\fontdimen sub1 0.15em down, sup2 0.363em up', () => {
    // TeX: shift down max(sub1, h(sub) − ⁴⁄₅ x-height) = max(0.15, 0.106).
    assert.deepEqual(
      ext([math(h('msub', {}, [h('mi', {}, ['x']), h('mn', {}, ['1'])]))]),
      [0.4306, 0.15]
    );
    // Shift up sup2 (text style): 0.3629 + 0.7 × 0.6444 (cmr10 digits).
    assert.deepEqual(
      ext([math(h('msup', {}, [h('mi', {}, ['x']), h('mn', {}, ['2'])]))]),
      [0.814, 0]
    );
  });

  test('the ▷ of \\Comment (cmmi10) and unknown characters', () => {
    assert.deepEqual(ext([math(h('mo', {}, ['▷']))]), [0.4653, 0]);
    // Not in the tables: an x-height box, so the line keeps a sane size.
    assert.deepEqual(ext(['…']), [0.4306, 0]);
    assert.deepEqual(ext([]), [0, 0]);
  });
});

describe('textWidth: an \\hbox’s natural width from the TFM widths', () => {
  // pdflatex (fixtures/algorithm-basic, 11pt): "Require:" 46.615bp,
  // "Ensure:" 41.525bp, "Algorithm 1" 66.92bp; × 72.27/72 / 10.95 → em.
  test('bold labels, a tie as the font’s interword space', () => {
    assert.equal(Number(textWidth('Require:', 'bf').toFixed(4)), 4.2749);
    assert.equal(Number(textWidth('Ensure:', 'bf').toFixed(4)), 3.8071);
    assert.equal(
      Number(textWidth('Algorithm\u00a01', 'bf').toFixed(4)),
      6.1345
    );
  });

  test('characters outside the table count as half an em', () => {
    assert.equal(textWidth('é', 'rm'), 0.5);
  });
});
