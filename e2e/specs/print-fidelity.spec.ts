import { test, expect } from '@playwright/test';
import { setSource } from '../support/editor.ts';
import fs from 'node:fs';

/**
 * Print fidelity: render a fixture and compare where its lines land with
 * where pdflatex put them (fixtures/<name>/reference-lines.json). Positions
 * are compared in PostScript points from the page's top-left corner.
 */

interface RefLine {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  words: { text: string; xMin: number; xMax: number }[];
}

/** The reference line containing `needle`, and the x of the word it starts at. */
function locate(
  lines: RefLine[],
  needle: string
): { line: RefLine; x: number } {
  const line = lines.find((l) => l.text.includes(needle));
  if (!line) throw new Error(`"${needle}" is not in the reference`);
  const wordIndex =
    line.text.slice(0, line.text.indexOf(needle)).split(' ').length - 1;
  return { line, x: line.words[wordIndex].xMin };
}

/** Computer Modern FontDescriptor ascent/descent (694/−194): poppler's box → baseline. */
const refBaseline = (l: RefLine) => l.yMin + ((l.yMax - l.yMin) * 694) / 888;

const fixture = 'article-basic';
const source = fs.readFileSync(`fixtures/${fixture}/input.tex`, 'utf8');
const reference = JSON.parse(
  fs.readFileSync(`fixtures/${fixture}/reference-lines.json`, 'utf8')
) as { pages: { lines: RefLine[] }[] };

/** Lines whose start we check: each paragraph, heading, title-block line and list item. */
const CHECKED = [
  'A Short Example',
  'Ada Lovelace',
  '31 October 2026',
  'Introduction',
  'This document is written',
  'Later paragraphs are indented',
  'Lists',
  'Lists come in three kinds',
  'Enumerated lists are numbered',
  'First.',
  'Second.',
  'Conclusion',
  'That is all for now.',
];

test.describe(`print fidelity: ${fixture}`, () => {
  test.use({ viewport: { width: 1900, height: 1200 } });

  test('every line breaks where pdflatex breaks it', async ({ page }) => {
    await page.goto('/');
    await setSource(page, source);
    await expect(
      page.frameLocator('latex-preview iframe').locator('.date')
    ).toHaveText('31 October 2026');
    const frame = (await (await page
      .locator('latex-preview iframe')
      .elementHandle())!.contentFrame())!;

    // First word of every visual line of body text (labels excluded),
    // detected per character so breaks after dashes or hyphens count too.
    const ours = await frame.evaluate(async () => {
      await document.fonts.ready;
      const starts: string[] = [];
      for (const para of document.querySelectorAll('article p')) {
        const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            n.parentElement!.closest('.item-label')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });
        let lastTop: number | null = null;
        let line = '';
        const lines: string[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent!;
          for (let i = 0; i < text.length; i++) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const rect = r.getClientRects()[0];
            if (!rect) continue; // collapsed whitespace
            // Half a line: raised/lowered glyphs (logos) don't count.
            if (lastTop !== null && rect.top > lastTop + 9) {
              lines.push(line);
              line = '';
            }
            line += text[i];
            lastTop = rect.top;
          }
        }
        lines.push(line);
        for (const l of lines) {
          const first = l.trim().split(/\s+/)[0];
          if (first) starts.push(first);
        }
      }
      return starts;
    });

    const norm = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '');
    const isLabelOrNumber = (w: string) => /^(\d+(\.\d+)*\.?|\x88|•)$/.test(w);
    const headings = new Set(['Introduction', 'Lists', 'Conclusion']);
    const expected = reference.pages[0].lines
      .filter((l) => l.yMin > 260 && l.yMin < 700) // body text, not title or folio
      .filter((l) => !headings.has(l.text) && !isLabelOrNumber(l.text))
      .map((l) => l.text.split(' ').find((w) => !isLabelOrNumber(w)))
      .filter((w): w is string => !!w);
    expect(ours.map(norm)).toEqual(expected.map(norm));
  });

  test('paragraph, heading and list positions match pdflatex', async ({
    page,
  }) => {
    await page.goto('/');
    await setSource(page, source);
    await expect(
      page.frameLocator('latex-preview iframe').locator('.date')
    ).toHaveText('31 October 2026');
    const frame = (await (await page
      .locator('latex-preview iframe')
      .elementHandle())!.contentFrame())!;

    const measured = await frame.evaluate(async (needles) => {
      await document.fonts.ready;
      const pageBox = document
        .querySelector('.latex-page')!
        .getBoundingClientRect();
      // The test viewport is wide enough that the preview is not scaled.
      const zoom = 1;
      const PX_TO_PT = 0.75;
      const out: Record<string, { x: number; baseline: number } | null> = {};
      for (const needle of needles) {
        const walker = document.createTreeWalker(
          document.querySelector('article')!,
          NodeFilter.SHOW_TEXT
        );
        let found: { x: number; baseline: number } | null = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.textContent!.indexOf(needle);
          if (i === -1) continue;
          const range = document.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          const rect = range.getClientRects()[0];
          const fs = parseFloat(getComputedStyle(n.parentElement!).fontSize);
          // Inline content box = ascent + descent = 1em (font metric overrides).
          found = {
            x: ((rect.left - pageBox.left) / zoom) * PX_TO_PT,
            baseline: ((rect.top - pageBox.top) / zoom + 0.806 * fs) * PX_TO_PT,
          };
          break;
        }
        out[needle] = found;
      }
      return out;
    }, CHECKED);

    const lines = reference.pages[0].lines;
    const rows = CHECKED.map((needle) => {
      const { line, x } = locate(lines, needle);
      const ours = measured[needle];
      expect(ours, `"${needle}" not found in the preview`).not.toBeNull();
      return {
        needle,
        dx: ours!.x - x,
        dy: ours!.baseline - refBaseline(line),
      };
    });
    console.log(
      rows
        .map(
          (r) =>
            `${r.needle.padEnd(32)} dx=${r.dx.toFixed(2)}pt dy=${r.dy.toFixed(2)}pt`
        )
        .join('\n')
    );
    // Centred lines move by half any difference in line width, and glyph
    // advances differ slightly between Chromium builds: allow 1pt for those.
    const centred = new Set([
      'A Short Example',
      'Ada Lovelace',
      '31 October 2026',
    ]);
    for (const r of rows) {
      expect
        .soft(Math.abs(r.dx), `x of "${r.needle}" (pt)`)
        .toBeLessThanOrEqual(centred.has(r.needle) ? 1 : 0.5);
      expect
        .soft(Math.abs(r.dy), `baseline of "${r.needle}" (pt)`)
        .toBeLessThanOrEqual(1);
    }
  });
});
