import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseLength } from './lengths.ts';

const ctx = { textwidth: 360, em: 11, ex: 4.71 }; // bp

describe('parseLength (to CSS/PostScript points)', () => {
  test('TeX units, as TeX defines them', () => {
    const near = (s: string, bp: number) => {
      const v = parseLength(s, ctx);
      assert.ok(
        v !== null && Math.abs(v - bp) < 0.001,
        `${s} = ${v}, want ${bp}`
      );
    };
    near('72.27pt', 72);
    near('72bp', 72);
    near('1in', 72);
    near('2.54cm', 72);
    near('25.4mm', 72);
    near('1pc', 12 * (72 / 72.27));
    near('2em', 22);
    near('1ex', 4.71);
    near(' 3 cm ', (3 / 2.54) * 72);
    near('-1pt', -72 / 72.27);
  });

  test('fractions of the text width', () => {
    assert.strictEqual(parseLength('\\textwidth', ctx), 360);
    assert.strictEqual(parseLength('0.5\\linewidth', ctx), 180);
    assert.strictEqual(parseLength('.25\\columnwidth', ctx), 90);
    assert.strictEqual(parseLength('-\\hsize', ctx), -360);
    assert.strictEqual(parseLength('+\\textwidth', ctx), 360);
  });

  test('signs, em and ex', () => {
    assert.strictEqual(parseLength('-2em', ctx), -22);
    assert.strictEqual(parseLength('+1ex', ctx), 4.71);
  });

  test('anything else is not a length', () => {
    for (const s of [
      '',
      'wide',
      '3',
      '3 parsecs',
      '\\foo',
      '1pt plus 2pt',
      'pt',
      '2zz',
    ])
      assert.strictEqual(parseLength(s, ctx), null, s);
  });
});
