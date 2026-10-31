/**
 * Page and type geometry of the standard `article` class, computed the way
 * article.cls and size10/11/12.clo compute it (one-column, oneside, not in
 * compatibility mode). All lengths are TeX points (1/72.27 in); convert with
 * `toBp` for CSS, whose `pt` is 1/72 in.
 */

export type PointSize = 10 | 11 | 12;
export type Paper =
  | 'letterpaper'
  | 'a4paper'
  | 'a5paper'
  | 'b5paper'
  | 'legalpaper'
  | 'executivepaper';

export interface ClassOptions {
  size: PointSize;
  paper: Paper;
}

export type SizeName =
  | 'tiny'
  | 'scriptsize'
  | 'footnotesize'
  | 'small'
  | 'normalsize'
  | 'large'
  | 'Large'
  | 'LARGE'
  | 'huge'
  | 'Huge';

export interface FontSize {
  fontSize: number;
  baselineskip: number;
}

export interface ArticleGeometry {
  options: ClassOptions;
  paperWidth: number;
  paperHeight: number;
  textWidth: number;
  textHeight: number;
  /** Distance from the left paper edge to the text block (1in + \oddsidemargin). */
  textLeft: number;
  /** Distance from the top paper edge to the text block (1in + \topmargin + \headheight + \headsep). */
  textTop: number;
  topskip: number;
  footskip: number;
  fontSize: number;
  baselineskip: number;
  parindent: number;
  /** One em of the normal font (Computer/Latin Modern quad = font size). */
  em: number;
  sizes: Record<SizeName, FontSize>;
  list: {
    topsep: number;
    partopsep: number;
    parsep: number;
    itemsep: number;
    labelsep: number;
    leftmargini: number;
  };
  footnotesep: number;
}

const INCH = 72.27;
const MM = INCH / 25.4;

/** TeX points → PostScript/PDF/CSS points. */
export function toBp(pt: number): number {
  return (pt * 72) / 72.27;
}

/** article.cls paper options (width, height). */
const PAPERS: Record<Paper, [number, number]> = {
  letterpaper: [8.5 * INCH, 11 * INCH],
  legalpaper: [8.5 * INCH, 14 * INCH],
  executivepaper: [7.25 * INCH, 10.5 * INCH],
  a4paper: [210 * MM, 297 * MM],
  a5paper: [148 * MM, 210 * MM],
  b5paper: [176 * MM, 250 * MM],
};

/** \@vpt … \@xxvpt from latex.ltx. */
const PT = {
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 10.95,
  xii: 12,
  xiv: 14.4,
  xvii: 17.28,
  xx: 20.74,
  xxv: 24.88,
};

const f = (fontSize: number, baselineskip: number): FontSize => ({
  fontSize,
  baselineskip,
});

/** \@setfontsize tables from size10/11/12.clo. */
const SIZES: Record<PointSize, Record<SizeName, FontSize>> = {
  10: {
    tiny: f(PT.v, 6),
    scriptsize: f(PT.vii, 8),
    footnotesize: f(PT.viii, 9.5),
    small: f(PT.ix, 11),
    normalsize: f(PT.x, 12),
    large: f(PT.xii, 14),
    Large: f(PT.xiv, 18),
    LARGE: f(PT.xvii, 22),
    huge: f(PT.xx, 25),
    Huge: f(PT.xxv, 30),
  },
  11: {
    tiny: f(PT.vi, 7),
    scriptsize: f(PT.viii, 9.5),
    footnotesize: f(PT.ix, 11),
    small: f(PT.x, 12),
    normalsize: f(PT.xi, 13.6),
    large: f(PT.xii, 14),
    Large: f(PT.xiv, 18),
    LARGE: f(PT.xvii, 22),
    huge: f(PT.xx, 25),
    Huge: f(PT.xxv, 30),
  },
  12: {
    tiny: f(PT.vi, 7),
    scriptsize: f(PT.viii, 9.5),
    footnotesize: f(PT.x, 12),
    small: f(PT.xi, 13.6),
    normalsize: f(PT.xii, 14.5),
    large: f(PT.xiv, 18),
    Large: f(PT.xvii, 22),
    LARGE: f(PT.xx, 25),
    huge: f(PT.xxv, 30),
    Huge: f(PT.xxv, 30), // size12.clo: \let\Huge=\huge
  },
};

/** Per-size constants from size1x.clo. */
const CLO: Record<
  PointSize,
  {
    maxTextWidth: number;
    topskip: number;
    /** \parindent: a length, or a multiple of em. */
    parindent: number | { em: number };
    listi: { topsep: number; parsep: number; itemsep: number };
    partopsep: number;
    footnotesep: number;
  }
> = {
  10: {
    maxTextWidth: 345,
    topskip: 10,
    parindent: 15,
    listi: { topsep: 8, parsep: 4, itemsep: 4 },
    partopsep: 2,
    footnotesep: 6.65,
  },
  11: {
    maxTextWidth: 360,
    topskip: 11,
    parindent: 17,
    listi: { topsep: 9, parsep: 4.5, itemsep: 4.5 },
    partopsep: 3,
    footnotesep: 7.7,
  },
  12: {
    maxTextWidth: 390,
    topskip: 12,
    parindent: { em: 1.5 },
    listi: { topsep: 10, parsep: 5, itemsep: 5 },
    partopsep: 3,
    footnotesep: 8.4,
  },
};

const HEADHEIGHT = 12;
const HEADSEP = 25;
const FOOTSKIP = 30;

/** \@settopoint: truncate to a whole number of points. */
const settopoint = (pt: number) => Math.trunc(pt);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Interpret \documentclass options the way article.cls does (last one wins). */
export function classOptions(options: string[]): ClassOptions {
  let size: PointSize = 10;
  let paper: Paper = 'letterpaper';
  for (const option of options) {
    if (option === '10pt') size = 10;
    else if (option === '11pt') size = 11;
    else if (option === '12pt') size = 12;
    else if (option in PAPERS) paper = option as Paper;
  }
  return { size, paper };
}

export function articleGeometry(options: ClassOptions): ArticleGeometry {
  const clo = CLO[options.size];
  const sizes = SIZES[options.size];
  const [paperWidth, paperHeight] = PAPERS[options.paper];
  const { fontSize, baselineskip } = sizes.normalsize;
  const em = fontSize;

  // size1x.clo, non-compatibility branch.
  const textWidth = settopoint(
    Math.min(clo.maxTextWidth, paperWidth - 2 * INCH)
  );
  const lines = Math.floor(
    (paperHeight - 2 * INCH - 1.5 * INCH) / baselineskip
  );
  const textHeight = round(lines * baselineskip + clo.topskip);
  const oddsidemargin = settopoint(0.5 * (paperWidth - textWidth) - INCH);
  const rawTop =
    paperHeight - 2 * INCH - HEADHEIGHT - HEADSEP - textHeight - FOOTSKIP;
  const topmargin = settopoint(rawTop - 0.5 * rawTop);

  const parindent =
    typeof clo.parindent === 'number' ? clo.parindent : clo.parindent.em * em;

  return {
    options,
    paperWidth,
    paperHeight,
    textWidth,
    textHeight,
    textLeft: round(INCH + oddsidemargin),
    textTop: round(INCH + topmargin + HEADHEIGHT + HEADSEP),
    topskip: clo.topskip,
    footskip: FOOTSKIP,
    fontSize,
    baselineskip,
    parindent: round(parindent),
    em,
    sizes,
    list: {
      ...clo.listi,
      partopsep: clo.partopsep,
      // article.cls: \labelsep .5em, \leftmargini 2.5em (one column).
      labelsep: round(0.5 * em),
      leftmargini: round(2.5 * em),
    },
    footnotesep: clo.footnotesep,
  };
}
