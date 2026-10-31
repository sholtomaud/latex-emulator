import { describe, test } from 'node:test';
import assert from 'node:assert';
import { articleGeometry, classOptions, toBp } from './article.ts';
import reference from '../../../fixtures/article-basic/reference-lines.json' with { type: 'json' };

const close = (actual: number, expected: number, tolerance = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`
  );

describe('classOptions', () => {
  test('defaults: 10pt, letterpaper', () => {
    assert.deepStrictEqual(classOptions([]), {
      size: 10,
      paper: 'letterpaper',
    });
  });

  test('reads size and paper, ignoring unknown options', () => {
    assert.deepStrictEqual(classOptions(['12pt', 'draft', 'a4paper']), {
      size: 12,
      paper: 'a4paper',
    });
  });

  test('the last of conflicting options wins, as in LaTeX', () => {
    assert.deepStrictEqual(
      classOptions(['11pt', '10pt', 'a4paper', 'a5paper']),
      {
        size: 10,
        paper: 'a5paper',
      }
    );
  });
});

describe('articleGeometry (values in TeX pt, from size1x.clo)', () => {
  test('11pt: fonts, \\textwidth, \\parindent', () => {
    const g = articleGeometry({ size: 11, paper: 'a4paper' });
    assert.strictEqual(g.fontSize, 10.95);
    assert.strictEqual(g.baselineskip, 13.6);
    assert.strictEqual(g.textWidth, 360);
    assert.strictEqual(g.parindent, 17);
    assert.strictEqual(g.topskip, 11);
  });

  test('10pt and 12pt \\textwidth and \\parindent', () => {
    assert.strictEqual(
      articleGeometry({ size: 10, paper: 'letterpaper' }).textWidth,
      345
    );
    assert.strictEqual(
      articleGeometry({ size: 10, paper: 'letterpaper' }).parindent,
      15
    );
    const g12 = articleGeometry({ size: 12, paper: 'letterpaper' });
    assert.strictEqual(g12.textWidth, 390);
    assert.strictEqual(g12.parindent, 18); // 1.5em of 12pt
  });

  test('10pt letter \\textheight is the classic 550pt (45 lines + topskip)', () => {
    assert.strictEqual(
      articleGeometry({ size: 10, paper: 'letterpaper' }).textHeight,
      550
    );
  });

  test('A4 11pt text block matches pdflatex (fixtures/article-basic)', () => {
    const g = articleGeometry({ size: 11, paper: 'a4paper' });
    const page = reference.pages[0];
    close(toBp(g.paperWidth), page.width);
    close(toBp(g.paperHeight), page.height);
    // Every unindented body line starts at the text block's left edge…
    close(toBp(g.textLeft), 117.83);
    // …and justified lines end at its right edge.
    close(toBp(g.textLeft + g.textWidth), 476.49, 0.02);
    const firstBody = page.lines.find((l) =>
      l.text.startsWith('This document')
    )!;
    close(firstBody.xMin, toBp(g.textLeft));
  });

  test('size commands follow the class table', () => {
    const g = articleGeometry({ size: 11, paper: 'a4paper' });
    assert.deepStrictEqual(g.sizes.LARGE, {
      fontSize: 17.28,
      baselineskip: 22,
    });
    assert.deepStrictEqual(g.sizes.footnotesize, {
      fontSize: 9,
      baselineskip: 11,
    });
    const g12 = articleGeometry({ size: 12, paper: 'a4paper' });
    assert.deepStrictEqual(g12.sizes.Huge, g12.sizes.huge);
  });

  test('narrow paper clamps \\textwidth to paperwidth − 2in', () => {
    const g = articleGeometry({ size: 12, paper: 'a5paper' });
    assert.ok(g.textWidth < 390);
    assert.strictEqual(g.textWidth, Math.floor(g.paperWidth - 2 * 72.27));
  });

  test('list and footnote parameters', () => {
    const g = articleGeometry({ size: 11, paper: 'a4paper' });
    // \@listi in size11.clo (not the \small values earlier in the file).
    assert.deepStrictEqual(g.list, {
      topsep: 9,
      partopsep: 3,
      parsep: 4.5,
      itemsep: 4.5,
      labelsep: 5.475,
      leftmargini: 27.375,
    });
    assert.strictEqual(g.footnotesep, 7.7);
  });

  test('consecutive enumerate items match pdflatex spacing', () => {
    const g = articleGeometry({ size: 11, paper: 'a4paper' });
    const lines = reference.pages[0].lines;
    const first = lines.find((l) => l.text === '1. First.')!;
    const second = lines.find((l) => l.text === '2. Second.')!;
    close(
      second.yMin - first.yMin,
      toBp(g.baselineskip + g.list.itemsep + g.list.parsep),
      0.02
    );
  });

  test('toBp converts TeX points to PostScript/CSS points', () => {
    close(toBp(72.27), 72);
  });
});
