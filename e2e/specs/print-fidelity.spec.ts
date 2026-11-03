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
  /** yMin/yMax: the word's own box (fixtures made since ADR 0016). */
  words: {
    text: string;
    xMin: number;
    xMax: number;
    yMin?: number;
    yMax?: number;
  }[];
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
/** The same for cmtt (611/−222). */
const refBaselineTt = (l: RefLine) => l.yMin + ((l.yMax - l.yMin) * 611) / 833;

interface FixtureSpec {
  name: string;
  /** Text that shows the preview has rendered the fixture. */
  ready: { selector: string; text: string };
  /** .bib files to import into the references library first. */
  bibFiles?: string[];
  /** Images to add to the document first (paths inside the fixture). */
  images?: string[];
  /**
   * Listing lines, in order: the reference line's text starts with `start`;
   * `tt` for typewriter lines (cmtt's FontDescriptor, 611/−222). Each is
   * compared with the first glyph of the matching .lst-line.
   */
  codeLines?: {
    start: string;
    tt?: boolean;
    /**
     * When poppler's box is no use (a line mixing in cmsy's ∗ is taller),
     * the baseline is `by` pt below the line starting with `line`.
     */
    below?: { line: string; by: number };
  }[];
  /**
   * Algorithm lines (ADR 0016), in order: `word` is the first word of the
   * line's text (after any number or label), compared with the first glyph
   * of the matching .alg-text, using the word's own box for the baseline
   * (lines mix cmr, cmmi and cmsy). `comment` is the comment's last word:
   * its right edge is checked, as the comment is set flush right.
   */
  algLines?: {
    word: string;
    comment?: string;
    /**
     * Why this line's ▷ is known to miss the tolerance. It is asserted in
     * an expected-failure test, so it turns red (and this note must go)
     * once fixed.
     */
    triangleGap?: string;
  }[];
  /** Vertical ranges (pt) of algorithm bodies, skipped by the line-break check. */
  algBodies?: [number, number][];
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
  {
    name: 'listings-basic',
    ready: { selector: '.lst-line', text: 'squares' },
    checked: [
      'Code',
      'Listing',
      'inline',
      'Listing 1:',
      'The text continues',
      'of this paragraph',
      'After both listings',
    ],
    centred: ['Listing 1:'],
    headings: ['Code'],
    body: [140, 700],
    // Line numbers of the framed listing.
    displayLines: ['1', '2', '3', '4'],
    codeLines: [
      { start: 'def' },
      { start: '# the' },
      // Contains cmsy's ∗: one \baselineskip (13.6pt) below the comment.
      { start: 'return [', below: { line: '# the', by: (13.6 * 72) / 72.27 } },
      { start: 'int main', tt: true },
      { start: 'printf', tt: true },
      { start: 'return 0', tt: true },
      { start: '}', tt: true },
    ],
  },
  {
    name: 'algorithm-basic',
    ready: { selector: '.alg-text', text: 'integers' },
    checked: [
      'Pseudocode',
      'Algorithm 1 is',
      'that the',
      'Euclid’s algorithm',
      'The text continues',
      'line of this',
      'Sum of the positive',
      'After both',
      'numbers.',
    ],
    headings: ['Pseudocode'],
    body: [140, 700],
    algBodies: [
      [200, 350],
      [420, 640],
    ],
    algLines: [
      { word: 'integers' },
      { word: 'the' },
      { word: 'procedure', comment: 'b' },
      { word: 'r' },
      {
        word: 'while',
        comment: '0',
        // Flush right, so its x is the comment's width from the margin.
        triangleGap:
          'The browser rounds each glyph advance to a whole pixel: across this comment’s 28 characters that adds up to 1.7pt.',
      },
      { word: 'a' },
      { word: 'b' },
      { word: 'r' },
      { word: 'end' },
      { word: 'return', comment: 'b' },
      { word: 'end' },
      { word: 'function' },
      { word: 's' },
      { word: 'for' },
      { word: 'if' },
      { word: 's' },
      { word: 'else' },
      { word: 'skip' },
      { word: 'else' },
      { word: 'count' },
      { word: 'end' },
      { word: 'end' },
      { word: 'repeat' },
      { word: 's' },
      { word: 'until' },
      { word: 'return' },
      { word: 'end' },
    ],
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
        // Listing lines are code, checked by codeLines.
        for (const para of document.querySelectorAll(
          'article p:not(.lst-line)'
        )) {
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
      const code = (fixture.codeLines ?? []).map((c) => c.start);
      for (const l of reference.pages[0].lines.filter(
        (x) => !display.has(x.text) && !code.some((c) => x.text.startsWith(c))
      )) {
        const same = merged.find((m) => Math.abs(m.yMin - l.yMin) < 2);
        if (same) {
          if (l.xMin < same.xMin)
            Object.assign(same, { ...l, text: `${l.text} ${same.text}` });
          else same.text = `${same.text} ${l.text}`;
        } else merged.push({ ...l });
      }
      const inAlgorithm = (l: RefLine) =>
        (fixture.algBodies ?? []).some(([a, b]) => l.yMin > a && l.yMin < b);
      const expected = merged
        .filter((l) => l.yMin > top && l.yMin < bottom) // body text, not title or folio
        .filter((l) => !inAlgorithm(l))
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

    if (fixture.codeLines)
      test('listing lines start where pdflatex puts them', async ({ page }) => {
        const frame = await load(page);
        const ours = await frame.evaluate(async () => {
          await document.fonts.ready;
          const box = document
            .querySelector('.latex-page')!
            .getBoundingClientRect();
          const PX_TO_PT = 0.75;
          return [...document.querySelectorAll('.lst-line')].flatMap((line) => {
            const walker = document.createTreeWalker(
              line,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (n) =>
                  n.parentElement!.closest('.lst-num') || !n.textContent!.trim()
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
              }
            );
            const n = walker.nextNode();
            if (!n) return [];
            const at = n.textContent!.search(/\S/);
            const r = document.createRange();
            r.setStart(n, at);
            r.setEnd(n, at + 1);
            const rect = r.getClientRects()[0];
            // The baseline exactly: an empty inline-block's bottom edge sits on
            // it. (A glyph rect is rounded to whole pixels, which biases
            // "top + 0.806em" by up to 1pt, more at small sizes.)
            const probe = document.createElement('span');
            probe.style.cssText = 'display:inline-block;width:0;height:0';
            r.insertNode(probe);
            const baseline = probe.getBoundingClientRect().bottom;
            probe.remove();
            return [
              {
                x: (rect.left - box.left) * PX_TO_PT,
                baseline: (baseline - box.top) * PX_TO_PT,
              },
            ];
          });
        });
        const lines = reference.pages[0].lines;
        const rows = fixture.codeLines!.map((c, i) => {
          const find = (start: string) => {
            const l = lines.find((x) => x.text.startsWith(start));
            if (!l) throw new Error(`"${start}" is not in the reference`);
            return l;
          };
          const line = find(c.start);
          const base = c.below
            ? refBaseline(find(c.below.line)) + c.below.by
            : c.tt
              ? refBaselineTt(line)
              : refBaseline(line);
          return {
            start: c.start,
            dx: ours[i].x - line.xMin,
            dy: ours[i].baseline - base,
          };
        });
        console.log(
          rows
            .map(
              (r) =>
                `${r.start.padEnd(32)} dx=${r.dx.toFixed(2)}pt dy=${r.dy.toFixed(2)}pt`
            )
            .join('\n')
        );
        expect(ours).toHaveLength(fixture.codeLines!.length);
        for (const r of rows) {
          expect
            .soft(Math.abs(r.dx), `x of "${r.start}" (pt)`)
            .toBeLessThanOrEqual(0.5);
          expect
            .soft(Math.abs(r.dy), `baseline of "${r.start}" (pt)`)
            .toBeLessThanOrEqual(1);
        }
      });

    /** Each algorithm line's (and comment's) offset from pdflatex's. */
    async function algRows(page: Page) {
      const frame = await load(page);
      const ours = await frame.evaluate(async () => {
        await document.fonts.ready;
        const box = document
          .querySelector('.latex-page')!
          .getBoundingClientRect();
        const PX_TO_PT = 0.75;
        /** The first (or last) visible character's rect and baseline. */
        const glyph = (el: Element, last: boolean) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) =>
              n.textContent!.trim()
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT,
          });
          let n: Node | null = walker.nextNode();
          if (last) for (let m = n; m; m = walker.nextNode()) n = m;
          if (!n) return null;
          const t = n.textContent!;
          const at = last ? t.trimEnd().length - 1 : t.search(/\S/);
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + 1);
          const rect = r.getClientRects()[0];
          // The baseline exactly: an empty inline-block's bottom sits on it.
          // Inside MathML a span has no baseline: probe before the <math>.
          const probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:0;height:0';
          const math = n.parentElement!.closest('math');
          if (math) math.before(probe);
          else r.insertNode(probe);
          const baseline = probe.getBoundingClientRect().bottom;
          probe.remove();
          return {
            x: (rect.left - box.left) * PX_TO_PT,
            right: (rect.right - box.left) * PX_TO_PT,
            baseline: (baseline - box.top) * PX_TO_PT,
          };
        };
        return [...document.querySelectorAll('.alg-line')].map((line) => ({
          text: glyph(line.querySelector('.alg-text')!, false),
          comment: line.querySelector('.alg-comment')
            ? glyph(line.querySelector('.alg-comment')!, true)
            : null,
          triangle: line.querySelector('.alg-comment')
            ? glyph(line.querySelector('.alg-comment')!, false)
            : null,
        }));
      });
      // The reference words in reading order: each line's word is the
      // next occurrence below the previous one.
      const lines = [...reference.pages[0].lines].sort(
        (a, b) => a.yMin - b.yMin
      );
      const algBodies = fixture.algBodies ?? [];
      const words = lines
        .filter((l) => algBodies.some(([a, b]) => l.yMin > a && l.yMin < b))
        .flatMap((l) => l.words.map((w) => ({ ...w, line: l })));
      const wordBaseline = (w: (typeof words)[number]) =>
        w.yMin! + ((w.yMax! - w.yMin!) * 694) / 888;
      let from = 0;
      const rows: {
        what: string;
        dx: number;
        dy: number;
        tol: number;
        gap?: string;
      }[] = [];
      fixture.algLines!.forEach((spec, i) => {
        const at = words.findIndex(
          (w, j) => j >= from && w.text === spec.word && !/^\d+:$/.test(w.text)
        );
        if (at < 0) throw new Error(`"${spec.word}" is not in the reference`);
        const w = words[at];
        // The next line's word is on a later baseline.
        from = words.findIndex(
          (x, j) => j > at && wordBaseline(x) > wordBaseline(w) + 3
        );
        if (from < 0) from = words.length;
        const mine = ours[i]?.text;
        expect(mine, `line ${i + 1} not found in the preview`).toBeTruthy();
        rows.push({
          what: `${i + 1}: ${spec.word}`,
          dx: mine!.x - w.xMin,
          dy: mine!.baseline - wordBaseline(w),
          tol: 0.5,
        });
        if (spec.comment) {
          // The comment's last word, on the same line (by baseline).
          const c = words.find(
            (x, j) =>
              j >= at &&
              x.text === spec.comment &&
              Math.abs(wordBaseline(x) - wordBaseline(w)) < 3 &&
              x.xMin > 300
          );
          if (!c) throw new Error(`comment "${spec.comment}" not found`);
          const cm = ours[i].comment;
          expect(cm, `line ${i + 1} has no comment`).toBeTruthy();
          rows.push({
            what: `${i + 1}: ▷ … ${spec.comment} (right)`,
            dx: cm!.right - c.xMax,
            dy: cm!.baseline - wordBaseline(c),
            tol: 1,
          });
          // The ▷: where the comment starts, so its width counts.
          const tri = words.find(
            (x, j) =>
              j >= at &&
              x.text === '▷' &&
              Math.abs(wordBaseline(x) - wordBaseline(w)) < 3
          );
          if (!tri) throw new Error(`no ▷ on line ${i + 1}`);
          rows.push({
            what: `${i + 1}: ▷ (left)`,
            dx: ours[i].triangle!.x - tri.xMin,
            dy: 0,
            tol: 1,
            gap: spec.triangleGap,
          });
        }
      });
      console.log(
        rows
          .map(
            (r) =>
              `${r.what.padEnd(32)} dx=${r.dx.toFixed(2)}pt dy=${r.dy.toFixed(2)}pt`
          )
          .join('\n')
      );
      expect(ours).toHaveLength(fixture.algLines!.length);
      return rows;
    }

    const expectWithin = (rows: Awaited<ReturnType<typeof algRows>>) => {
      for (const r of rows) {
        expect
          .soft(Math.abs(r.dx), `x of "${r.what}" (pt)`)
          .toBeLessThanOrEqual(r.tol);
        expect
          .soft(Math.abs(r.dy), `baseline of "${r.what}" (pt)`)
          .toBeLessThanOrEqual(1);
      }
    };

    if (fixture.algLines)
      test('algorithm lines start where pdflatex puts them', async ({
        page,
      }) => {
        expectWithin((await algRows(page)).filter((r) => !r.gap));
      });

    const triangleGaps = (fixture.algLines ?? []).filter((l) => l.triangleGap);
    if (triangleGaps.length)
      test('known algorithm gap', async ({ page }) => {
        test.fail(true, triangleGaps.map((l) => l.triangleGap).join(' '));
        expectWithin((await algRows(page)).filter((r) => r.gap));
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
