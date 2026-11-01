import type { ArticleGeometry, SizeName } from '../latex/classes/article.ts';
import { toBp } from '../latex/classes/article.ts';
import { formatToday } from './typeset-text.ts';

/**
 * Latin Modern's typographic ascent/descent (OS/2 sTypo, 806/194 per 1000).
 * Pinned with @font-face overrides so every browser and platform puts the
 * baseline at the same place in a line box, which the spacing model relies on.
 */
export const FONT_ASCENT = 0.806;
export const FONT_DESCENT = 0.194;
/** cmr10's x-height: 1ex = 0.430555em (TeX fontdimen 5). */
const EX = 0.430555;

export interface FontFace {
  file: string;
  family: string;
  weight: 400 | 700;
  style: 'normal' | 'italic';
  /**
   * The face's space advance (1/1000 em) when its no-break space is wider:
   * a tie font (scripts/make-tie-fonts.ts) then sets U+00A0 to this width,
   * as TeX's ~ is an ordinary interword space.
   */
  tie?: number;
}

/** Optical sizes as LaTeX uses them: 10 for text, 12 for headings, 17 for the title. */
export const FONT_FACES: FontFace[] = [
  // Latin Modern Math (GUST Font License): the OpenType MATH font MathML uses.
  {
    file: 'latinmodern-math',
    family: 'Latin Modern Math',
    weight: 400,
    style: 'normal',
  },
  {
    file: 'lmroman10-regular',
    family: 'LM Roman 10',
    weight: 400,
    style: 'normal',
    tie: 333,
  },
  {
    file: 'lmroman10-italic',
    family: 'LM Roman 10',
    weight: 400,
    style: 'italic',
    tie: 358,
  },
  {
    file: 'lmroman10-bold',
    family: 'LM Roman 10',
    weight: 700,
    style: 'normal',
    tie: 383,
  },
  {
    file: 'lmroman10-bolditalic',
    family: 'LM Roman 10',
    weight: 700,
    style: 'italic',
    tie: 414,
  },
  {
    file: 'lmroman12-regular',
    family: 'LM Roman 12',
    weight: 400,
    style: 'normal',
    tie: 326,
  },
  {
    file: 'lmroman12-italic',
    family: 'LM Roman 12',
    weight: 400,
    style: 'italic',
    tie: 350,
  },
  {
    file: 'lmroman12-bold',
    family: 'LM Roman 12',
    weight: 700,
    style: 'normal',
    tie: 375,
  },
  {
    file: 'lmroman17-regular',
    family: 'LM Roman 17',
    weight: 400,
    style: 'normal',
    tie: 302,
  },
  {
    file: 'lmromancaps10-regular',
    family: 'LM Roman Caps 10',
    weight: 400,
    style: 'normal',
    tie: 378,
  },
  {
    file: 'lmromanslant10-regular',
    family: 'LM Roman Slanted 10',
    weight: 400,
    style: 'normal',
    tie: 333,
  },
  {
    file: 'lmmono10-regular',
    family: 'LM Mono 10',
    weight: 400,
    style: 'normal',
  },
  {
    file: 'lmmono10-italic',
    family: 'LM Mono 10',
    weight: 400,
    style: 'italic',
  },
  {
    file: 'lmsans10-regular',
    family: 'LM Sans 10',
    weight: 400,
    style: 'normal',
    tie: 333,
  },
  {
    file: 'lmsans10-bold',
    family: 'LM Sans 10',
    weight: 700,
    style: 'normal',
    tie: 367,
  },
];

/** @font-face rules; `urls` maps a face's `file` to its served URL. */
export function fontFaceCss(urls: Record<string, string>): string {
  const face = (f: FontFace, extra: string, url: string, format: string) =>
    `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: ${f.style}; ` +
    `font-display: block; ascent-override: ${pct(FONT_ASCENT)}; descent-override: ${pct(FONT_DESCENT)}; line-gap-override: 0%; ` +
    `${extra}src: url(${JSON.stringify(url)}) format('${format}'); }`;
  return FONT_FACES.filter((f) => urls[f.file])
    .flatMap((f) => {
      const tie = f.tie && urls[`tie-${f.tie}`];
      // Declared after the face, so it wins for U+00A0 (the later face does).
      return tie
        ? [
            face(f, '', urls[f.file], 'woff2'),
            face(f, 'unicode-range: U+00A0; ', tie, 'truetype'),
          ]
        : [face(f, '', urls[f.file], 'woff2')];
    })
    .join('\n');
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const pt = (texPt: number) => `${round(toBp(texPt))}pt`;
const round = (n: number) => Math.round(n * 10000) / 10000;

/** Displayed-equation skips (\abovedisplayskip natural size) from size1x.clo. */
const ABOVE_DISPLAY: Record<number, number> = { 10: 10, 11: 11, 12: 12 };

/**
 * Custom properties and @page rules derived from the class geometry. The
 * static rules in styles/document/*.css consume these variables.
 */
export function geometryCss(g: ArticleGeometry): string {
  const ex = EX * g.fontSize;
  const em = g.em;
  const { list } = g;
  const sizeVars = (Object.keys(g.sizes) as SizeName[])
    .map(
      (s) =>
        `  --fs-${s}: ${pt(g.sizes[s].fontSize)};\n  --lh-${s}: ${pt(g.sizes[s].baselineskip)};`
    )
    .join('\n');

  const right = g.paperWidth - g.textLeft - g.textWidth;
  const bottom = g.paperHeight - g.textTop - g.textHeight;
  // Page number: its baseline sits \footskip below the text block.
  const footBaselineInLine =
    (g.baselineskip - g.fontSize) / 2 + FONT_ASCENT * g.fontSize;

  const vars = [
    `  --paper-width: ${pt(g.paperWidth)};`,
    `  --paper-height: ${pt(g.paperHeight)};`,
    `  --text-left: ${pt(g.textLeft)};`,
    `  --text-top: ${pt(g.textTop)};`,
    `  --text-width: ${pt(g.textWidth)};`,
    `  --text-height: ${pt(g.textHeight)};`,
    `  --fs: ${pt(g.fontSize)};`,
    `  --lh: ${pt(g.baselineskip)};`,
    `  --parindent: ${pt(g.parindent)};`,
    // Blocks add their own leading above the first baseline (see base.css), so
    // shift the text block up by \baselineskip − \topskip.
    `  --first-line-offset: ${pt(g.topskip - g.baselineskip)};`,
    sizeVars,
    `  --rm-family: '${g.options.size === 12 ? 'LM Roman 12' : 'LM Roman 10'}';`,
    `  --section-before: ${pt(3.5 * ex)};`,
    `  --section-after: ${pt(2.3 * ex)};`,
    `  --subsection-before: ${pt(3.25 * ex)};`,
    `  --subsection-after: ${pt(1.5 * ex)};`,
    // \\maketitle: \\null (a line at \\topskip), \\vskip 2em, then the title.
    `  --title-before: ${pt(2 * em + g.baselineskip)};`,
    `  --author-before: ${pt(1.5 * em)};`,
    `  --date-before: ${pt(1 * em)};`,
    `  --title-after: ${pt(list.topsep + list.partopsep + 1.5 * em)};`,
    `  --topsep: ${pt(list.topsep)};`,
    `  --partopsep: ${pt(list.partopsep)};`,
    `  --parsep: ${pt(list.parsep)};`,
    `  --itemsep: ${pt(list.itemsep)};`,
    `  --labelsep: ${pt(list.labelsep)};`,
    `  --leftmargin-1: ${pt(list.leftmargini)};`,
    `  --leftmargin-2: ${pt(2.2 * em)};`,
    `  --leftmargin-3: ${pt(1.87 * em)};`,
    `  --leftmargin-4: ${pt(1.7 * em)};`,
    `  --displayskip: ${pt(ABOVE_DISPLAY[g.options.size])};`,
    // Floats and tables (size1x.clo \intextsep; article.cls).
    `  --intextsep: ${pt(g.options.size === 12 ? 14 : 12)};`,
    `  --abovecaptionskip: ${pt(10)};`,
    `  --tabcolsep: ${pt(6)};`,
    `  --arrayrulewidth: ${pt(0.4)};`,
    `  --doublerulesep: ${pt(2)};`,
    // \jot (latex.ltx): extra space between amsmath display rows.
    `  --jot: ${pt(3)};`,
    `  --footnotesep: ${pt(g.footnotesep)};`,
    `  --em-normal: ${pt(em)};`,
  ].join('\n');

  return `:root {\n${vars}\n}
@page {
  size: ${pt(g.paperWidth)} ${pt(g.paperHeight)};
  margin: ${pt(g.textTop)} ${pt(right)} ${pt(bottom)} ${pt(g.textLeft)};
  @bottom-center {
    content: counter(page);
    vertical-align: top;
    padding-top: ${pt(g.footskip - footBaselineInLine)};
    font-family: var(--rm-family), serif;
    font-size: ${pt(g.fontSize)};
    line-height: ${pt(g.baselineskip)};
  }
}`;
}

/** Stamp printed on preprints (see Workspace.preprintOf). */
export interface PreprintStampInput {
  version: string;
  /** ms since the epoch */
  date: number;
  sha256: string;
}

/** A CSS string literal; quotes, backslashes and newlines escaped. */
const cssString = (s: string) =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ')}"`;

/**
 * Footer stamp for preprints: version and date bottom-left, short SHA-256
 * bottom-right, on the page number's baseline in \footnotesize. App-level
 * only; the document's LaTeX is not changed (AGENTS.md §14 rule).
 */
export function preprintCss(
  stamp: PreprintStampInput,
  g: ArticleGeometry
): string {
  const { fontSize, baselineskip } = g.sizes.footnotesize;
  // Same baseline as the page number: \footskip below the text block.
  const baselineInLine = (baselineskip - fontSize) / 2 + FONT_ASCENT * fontSize;
  const box = (content: string, family: string) => `
    content: ${cssString(content)};
    vertical-align: top;
    padding-top: ${pt(g.footskip - baselineInLine)};
    font-family: ${family};
    font-size: ${pt(fontSize)};
    line-height: ${pt(baselineskip)};
    white-space: nowrap;`;
  const left = `Preprint · v${stamp.version} · ${formatToday(new Date(stamp.date))}`;
  const right = `SHA-256 ${stamp.sha256.slice(0, 16)}`;
  return `@page {
  @bottom-left {${box(left, 'var(--rm-family), serif')}
    text-align: left;
  }
  @bottom-right {${box(right, "'LM Mono 10', monospace")}
    text-align: right;
  }
}`;
}
