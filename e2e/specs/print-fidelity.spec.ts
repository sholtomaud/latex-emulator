import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
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

interface FixtureSpec {
  name: string;
  /** Text that shows the preview has rendered the fixture. */
  ready: { selector: string; text: string };
  /** .bib files to import into the references library first. */
  bibFiles?: string[];
  /** Images to add to the document first (paths inside the fixture). */
  images?: string[];
  /** Lines whose start we check: paragraphs, headings, title lines, items. */
  checked: string[];
  /**
   * Lines whose start depends on their own width: centred lines and centred
   * or right-aligned table cells (1pt horizontal tolerance instead of 0.5pt).
   * The CI browser rounds text widths to device pixels, which moves them.
   */
  centred?: string[];
  /** Heading lines, which the line-break check skips. */
  headings: string[];
  /** Vertical range (pt) of the body text whose line breaks are checked. */
  body: [number, number];
  /**
   * Why the line-break check is known to fail. It still runs, as an
   * expected failure, so it turns red (and this note must go) once fixed.
   */
  knownLineBreakGap?: string;
  /** Reference lines that are display math, not paragraph text. */
  displayLines?: string[];
  /** Equation numbers, checked against the .eqno elements in order. */
  eqnos?: string[];
  /**
   * Checked lines known to miss the tolerance, with the reason. They are
   * asserted in an expected-failure test, so it turns red once fixed.
   */
  knownPositionGaps?: { needles: string[]; reason: string };
}

const FIXTURES: FixtureSpec[] = [
  {
    name: 'article-basic',
    ready: { selector: '.date', text: '31 October 2026' },
    checked: [
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
    ],
    centred: ['A Short Example', 'Ada Lovelace', '31 October 2026'],
    headings: ['Introduction', 'Lists', 'Conclusion'],
    body: [260, 700],
  },
  {
    name: 'natbib-basic',
    ready: { selector: 'ul.thebibliography li', text: 'Mark' },
    bibFiles: ['refs.bib'],
    checked: [
      'Citations',
      'Energy systems were described',
      'References',
      'Mark',
      'Charles',
      'Howard',
      'Decision',
    ],
    headings: ['Citations', 'References'],
    body: [140, 700],
    knownLineBreakGap:
      'pdflatex fits these lines by shrinking interword glue close to its limit and hyphenates with TeX patterns ("trans-formity"); greedy CSS line breaking cannot. Needs Knuth–Plass (AGENTS.md §6, Tier 3; ADR 0007).',
  },
  {
    name: 'math-basic',
    ready: { selector: '.eqno', text: '(1)' },
    checked: [
      'Equations',
      'Energy is conserved',
      // Not 'such as': its line holds an inline fraction, which pdftotext
      // counts in the line box, so the reference baseline can't be derived.
      'and the next display',
      'Aligned equations',
      'Section',
      'ends it.',
    ],
    headings: ['Equations'],
    body: [140, 700],
    displayLines: [
      'e iπ + 1 = 0',
      '(1)',
      'n',
      'X',
      'k=1',
      'k =',
      'n(n + 1)',
      '.',
      '2',
      'f (x) = x 2 + 2x + 1',
      '(2)',
      '= (x + 1) 2 .',
      '(3)',
      'p',
      'α + β ≤ γ 2 + δ 2',
    ],
    eqnos: ['(1)', '(2)', '(3)'],
    knownPositionGaps: {
      needles: ['ends it.'],
      reason:
        'Text after a display with a \\sqrt drifts down a few points: Chromium sets radicals and their superscripts higher than TeX (Latin Modern Math’s MATH constants, not cmex/cmsy), and a CSS line box grows above and below for tall content where TeX’s interline glue absorbs the depth (ADR 0010).',
    },
  },
  {
    name: 'table-basic',
    ready: { selector: '.caption', text: 'Table' },
    checked: [
      'Tables',
      'Table',
      'Table 1:',
      'Name',
      'Count',
      'Apples',
      '1.20',
      'Total',
      'Text continues',
      'second line',
      'Table 2:',
      'need two lines',
      'Fuel',
      'EROI',
      'Coal',
      'Oil and gas',
      'After both tables',
    ],
    // Count is a c cell; 1.20 and EROI are r cells.
    centred: ['Table 1:', 'Count', '1.20', 'EROI'],
    headings: ['Tables'],
    body: [140, 700],
    // Table cells are not paragraph text.
    displayLines: [
      'Name',
      'Count Price',
      'Apples',
      '3',
      '1.20',
      'Pears',
      '12',
      '0.85',
      'Total',
      '2.05',
      'Fuel',
      'EROI',
      'Year',
      '46',
      '16',
      '2010',
      'Coal',
      'Oil and gas',
    ],
  },
  {
    name: 'figure-basic',
    ready: { selector: '.caption', text: 'Figure' },
    images: ['images/plot.png', 'images/bars.jpg'],
    checked: [
      'Figures',
      'Figure 1 is',
      'and Figure 2',
      'Figure 1:',
      'Text continues',
      'second line',
      'Figure 2:',
      'After both figures',
    ],
    centred: ['Figure 1:', 'Figure 2:'],
    headings: ['Figures'],
    body: [140, 700],
  },
];

for (const fixture of FIXTURES) {
  const source = fs.readFileSync(`fixtures/${fixture.name}/input.tex`, 'utf8');
  const reference = JSON.parse(
    fs.readFileSync(`fixtures/${fixture.name}/reference-lines.json`, 'utf8')
  ) as { pages: { lines: RefLine[] }[] };
  const CHECKED = fixture.checked;

  /** Open the app with the fixture's .bib files and source, and wait for it. */
  async function load(page: Page) {
    await page.goto('/');
    if (fixture.bibFiles) {
      await page.getByRole('button', { name: 'Toggle documents' }).click();
      await page
        .locator('document-explorer .import-bib-input')
        .setInputFiles(
          fixture.bibFiles.map((f) => `fixtures/${fixture.name}/${f}`)
        );
      await expect(page.getByRole('status')).toContainText('Imported');
      // Close it again: the fixture is measured at the usual layout.
      await page.getByRole('button', { name: 'Toggle documents' }).click();
    }
    if (fixture.images) {
      await page.getByRole('button', { name: 'Toggle documents' }).click();
      await page
        .locator('image-panel .add-image-input')
        .setInputFiles(
          fixture.images.map((f) => `fixtures/${fixture.name}/${f}`)
        );
      await expect(page.locator('image-panel .image-item')).toHaveCount(
        fixture.images.length
      );
      await page.getByRole('button', { name: 'Toggle documents' }).click();
    }
    await setSource(page, source);
    await expect(
      page
        .frameLocator('latex-preview iframe')
        .locator(fixture.ready.selector)
        .first()
    ).toContainText(fixture.ready.text);
    return (await (await page
      .locator('latex-preview iframe')
      .elementHandle())!.contentFrame())!;
  }

  test.describe(`print fidelity: ${fixture.name}`, () => {
    test.use({ viewport: { width: 1900, height: 1200 } });

    test('every line breaks where pdflatex breaks it', async ({ page }) => {
      test.fail(!!fixture.knownLineBreakGap, fixture.knownLineBreakGap);
      const frame = await load(page);

      // First word of every visual line of body text (labels excluded),
      // detected per character so breaks after dashes or hyphens count too.
      const ours = await frame.evaluate(async () => {
        await document.fonts.ready;
        const starts: string[] = [];
        for (const para of document.querySelectorAll('article p')) {
          const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
            // Labels aren't text; inline math is one box (its fraction
            // denominators are not new lines).
            acceptNode: (n) =>
              n.parentElement!.closest('.item-label, math')
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
      const isLabelOrNumber = (w: string) =>
        /^(\d+(\.\d+)*\.?|\x88|•)$/.test(w);
      const headings = new Set(fixture.headings);
      const [top, bottom] = fixture.body;
      // poppler splits a line at font changes: merge fragments on one baseline.
      const merged: RefLine[] = [];
      const display = new Set(fixture.displayLines ?? []);
      for (const l of reference.pages[0].lines.filter(
        (x) => !display.has(x.text)
      )) {
        const same = merged.find((m) => Math.abs(m.yMin - l.yMin) < 2);
        if (same) {
          if (l.xMin < same.xMin)
            Object.assign(same, { ...l, text: `${l.text} ${same.text}` });
          else same.text = `${same.text} ${l.text}`;
        } else merged.push({ ...l });
      }
      const expected = merged
        .filter((l) => l.yMin > top && l.yMin < bottom) // body text, not title or folio
        .filter((l) => {
          const words = l.text.split(' ').filter((w) => !isLabelOrNumber(w));
          return words.length > 0 && !headings.has(words.join(' '));
        })
        .map((l) => l.text.split(' ').find((w) => !isLabelOrNumber(w)))
        .filter((w): w is string => !!w);
      expect(ours.map(norm)).toEqual(expected.map(norm));
    });

    const gaps = fixture.knownPositionGaps;
    for (const group of [
      {
        title: 'paragraph, heading and list positions match pdflatex',
        needles: CHECKED.filter((n) => !gaps?.needles.includes(n)),
        gap: undefined as string | undefined,
      },
      ...(gaps
        ? [
            {
              title: 'known position gap',
              needles: gaps.needles,
              gap: gaps.reason,
            },
          ]
        : []),
    ])
      test(group.title, async ({ page }) => {
        test.fail(!!group.gap, group.gap);
        const frame = await load(page);

        const measured = await frame.evaluate(async (needles) => {
          await document.fonts.ready;
          const pageBox = document
            .querySelector('.latex-page')!
            .getBoundingClientRect();
          // The test viewport is wide enough that the preview is not scaled.
          const zoom = 1;
          const PX_TO_PT = 0.75;
          const out: Record<string, { x: number; baseline: number } | null> =
            {};
          for (const needle of needles) {
            const walker = document.createTreeWalker(
              document.querySelector('article')!,
              NodeFilter.SHOW_TEXT
            );
            let found: { x: number; baseline: number } | null = null;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              // A tie (~) is a no-break space here, a space in the reference.
              const i = n.textContent!.replace(/\u00a0/g, ' ').indexOf(needle);
              if (i === -1) continue;
              const range = document.createRange();
              range.setStart(n, i);
              range.setEnd(n, i + 1);
              const rect = range.getClientRects()[0];
              const fs = parseFloat(
                getComputedStyle(n.parentElement!).fontSize
              );
              // Inline content box = ascent + descent = 1em (font metric overrides).
              found = {
                x: ((rect.left - pageBox.left) / zoom) * PX_TO_PT,
                baseline:
                  ((rect.top - pageBox.top) / zoom + 0.806 * fs) * PX_TO_PT,
              };
              break;
            }
            out[needle] = found;
          }
          return out;
        }, group.needles);

        const lines = reference.pages[0].lines;
        const rows = group.needles.map((needle) => {
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
        const centred = new Set(fixture.centred ?? []);
        for (const r of rows) {
          expect
            .soft(Math.abs(r.dx), `x of "${r.needle}" (pt)`)
            .toBeLessThanOrEqual(centred.has(r.needle) ? 1 : 0.5);
          expect
            .soft(Math.abs(r.dy), `baseline of "${r.needle}" (pt)`)
            .toBeLessThanOrEqual(1);
        }
      });

    if (fixture.eqnos)
      test('equation numbers sit where pdflatex puts them', async ({
        page,
      }) => {
        const frame = await load(page);
        const ours = await frame.evaluate(async () => {
          await document.fonts.ready;
          const box = document
            .querySelector('.latex-page')!
            .getBoundingClientRect();
          const PX_TO_PT = 0.75;
          return [...document.querySelectorAll('.eqno')].map((el) => {
            const r = el.getBoundingClientRect();
            const fs = parseFloat(getComputedStyle(el).fontSize);
            const lh = parseFloat(getComputedStyle(el).lineHeight);
            return {
              text: el.textContent,
              right: (r.right - box.left) * PX_TO_PT,
              // A one-line box: baseline = top + half-leading + ascent.
              baseline:
                (r.top - box.top + (lh - fs) / 2 + 0.806 * fs) * PX_TO_PT,
            };
          });
        });
        const lines = reference.pages[0].lines.filter((l) =>
          fixture.eqnos!.includes(l.text)
        );
        expect(ours.map((o) => o.text)).toEqual(fixture.eqnos);
        const rows = ours.map((o, i) => ({
          text: o.text,
          dx: o.right - lines[i].xMax,
          dy: o.baseline - refBaseline(lines[i]),
        }));
        console.log(
          rows
            .map(
              (r) =>
                `${r.text!.padEnd(8)} dx=${r.dx.toFixed(2)}pt dy=${r.dy.toFixed(2)}pt`
            )
            .join('\n')
        );
        for (const r of rows) {
          expect
            .soft(Math.abs(r.dx), `right edge of ${r.text} (pt)`)
            .toBeLessThanOrEqual(0.5);
          expect
            .soft(Math.abs(r.dy), `baseline of ${r.text} (pt)`)
            .toBeLessThanOrEqual(1);
        }
      });
  });
}
