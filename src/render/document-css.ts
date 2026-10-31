import type { ArticleGeometry, SizeName } from '../latex/classes/article.ts';
import { toBp } from '../latex/classes/article.ts';

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
}

/** Optical sizes as LaTeX uses them: 10 for text, 12 for headings, 17 for the title. */
export const FONT_FACES: FontFace[] = [
  {
    file: 'lmroman10-regular',
    family: 'LM Roman 10',
    weight: 400,
    style: 'normal',
  },
  {
    file: 'lmroman10-italic',
    family: 'LM Roman 10',
    weight: 400,
    style: 'italic',
  },
  {
    file: 'lmroman10-bold',
    family: 'LM Roman 10',
    weight: 700,
    style: 'normal',
  },
  {
    file: 'lmroman10-bolditalic',
    family: 'LM Roman 10',
    weight: 700,
    style: 'italic',
  },
  {
    file: 'lmroman12-regular',
    family: 'LM Roman 12',
    weight: 400,
    style: 'normal',
  },
  {
    file: 'lmroman12-italic',
    family: 'LM Roman 12',
    weight: 400,
    style: 'italic',
  },
  {
    file: 'lmroman12-bold',
    family: 'LM Roman 12',
    weight: 700,
    style: 'normal',
  },
  {
    file: 'lmroman17-regular',
    family: 'LM Roman 17',
    weight: 400,
    style: 'normal',
  },
  {
    file: 'lmromancaps10-regular',
    family: 'LM Roman Caps 10',
    weight: 400,
    style: 'normal',
  },
  {
    file: 'lmromanslant10-regular',
    family: 'LM Roman Slanted 10',
    weight: 400,
    style: 'normal',
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
  },
  { file: 'lmsans10-bold', family: 'LM Sans 10', weight: 700, style: 'normal' },
];

/** @font-face rules; `urls` maps a face's `file` to its served URL. */
export function fontFaceCss(urls: Record<string, string>): string {
  return FONT_FACES.filter((f) => urls[f.file])
    .map(
      (f) =>
        `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: ${f.style}; ` +
        `font-display: block; ascent-override: ${pct(FONT_ASCENT)}; descent-override: ${pct(FONT_DESCENT)}; line-gap-override: 0%; ` +
        `src: url(${JSON.stringify(urls[f.file])}) format('woff2'); }`
    )
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
