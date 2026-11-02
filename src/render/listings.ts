/**
 * listings' line layout (listings.sty, lstmisc.sty), as HNodes. Pure.
 *
 * Fixed columns (the default, columns=[c]fixed): every output unit of n
 * characters is a box n × basewidth wide (\lst@OutputToken); its characters
 * are separated by \hss, with \hss at both ends for [c] (only after them for
 * [l], before for [r]) (\lst@FillFixed). Each character is placed from the
 * Computer Modern widths (Latin Modern's are the same), so overflowing
 * units squeeze exactly as TeX's negative \hss does. Runs of spaces are
 * whole columns.
 *
 * Flexible columns: units take their natural width. The first space after
 * a unit is a font space (\lst@outputspace); further spaces add basewidth to
 * the "lost space", which is kerned in before the next unit when positive
 * (flexible) or only at the start of a line (fullflexible). Each unit also
 * adds n × basewidth − its natural width; natural widths are known for
 * typewriter type (0.525em per character) and otherwise taken as the grid.
 *
 * In a roman basic style the characters come out of the OT1 cmr font, which
 * draws " as ” and has no straight quotes; listings itself swaps in
 * \textminus, \textasteriskcentered and friends (\lst@CCPutMacro).
 */
import { h } from './hnode.ts';
import type { HElement } from './hnode.ts';
import { lstLines, VISIBLE_SPACE } from '../latex/listings/lexer.ts';
import type { LstToken } from '../latex/listings/lexer.ts';
import type { LstLanguage } from '../latex/listings/language-types.ts';
import type { LstFont, LstSettings } from '../latex/listings/options.ts';
import { CM_METRICS } from '../latex/listings/cm-metrics.ts';
import type { CmMetrics } from '../latex/listings/cm-metrics.ts';

/** The Computer Modern font a style selects (OT1: cmtt has no bold). */
function metricsOf(font: LstFont, base?: LstFont): CmMetrics {
  const family = font.family ?? base?.family ?? 'rm';
  if (family === 'tt') return CM_METRICS.tt;
  if (family === 'sf') return CM_METRICS.sf;
  const bf = (font.series ?? base?.series) === 'bf';
  const shape = font.shape ?? base?.shape;
  const slanted = shape === 'it' || shape === 'sl';
  if (bf) return CM_METRICS[slanted ? 'bfit' : 'bf'];
  return CM_METRICS[shape === 'it' ? 'it' : shape === 'sl' ? 'sl' : 'rm'];
}

/** Widths of what listings prints for these ASCII characters in roman type. */
const ROMAN_WIDTHS: Record<string, number> = {
  '-': 0.7778, // \textminus
  '*': 0.5, // \textasteriskcentered
  '<': 0.7778, // \textless (math)
  '>': 0.7778,
  '\\': 0.5, // \textbackslash
  '{': 0.5,
  '}': 0.5,
  '|': 0.2778,
};

/** A unit's natural width in em (TFM widths, no kerns), as TeX boxes it. */
function naturalWidth(text: string, m: CmMetrics): number {
  let w = 0;
  for (const c of text) {
    const code = c === VISIBLE_SPACE ? 32 : c.charCodeAt(0);
    w +=
      m !== CM_METRICS.tt && ROMAN_WIDTHS[c] !== undefined
        ? ROMAN_WIDTHS[c]
        : code >= 32 && code <= 126
          ? m.widths[code - 32]
          : 0.5;
  }
  return w;
}

/** OT1 cmr glyphs for ASCII listings prints with \char or text commands. */
const OT1_ROMAN: Record<string, string> = {
  '"': '”', // cmr slot 34 is a closing double quote
  "'": '’', // \char39: cmr's right quote
  '`': '‘', // \char96
  '-': '−', // \textminus
  '*': '∗', // \textasteriskcentered
  '^': 'ˆ', // \textasciicircum (OT1: the circumflex accent)
  '~': '˜', // cmr slot 126: the tilde accent
};

export function ot1Roman(text: string): string {
  return text.replace(/["'`\-*^~]/g, (c) => OT1_ROMAN[c]);
}

/** Typewriter type keeps cmtt's own (curly) quotes. */
const OT1_TT: Record<string, string> = { "'": '’', '`': '‘' };

/** Font switches → the document's font classes (as \ttfamily, \bfseries…). */
export function fontClasses(font: LstFont, base?: LstFont): string[] {
  const family = font.family ?? base?.family;
  const classes: string[] = [];
  if (font.family && font.family !== base?.family) classes.push(font.family);
  // OT1 cmtt has no bold: pdflatex substitutes the medium weight.
  if (font.series === 'bf' && family !== 'tt') classes.push('bf');
  if (font.shape && font.shape !== 'up') classes.push(font.shape);
  if (font.size) classes.push(`size-${font.size}`);
  return classes;
}

const em = (n: number) => `${Number(n.toFixed(4)) || 0}em`;

function styleFont(t: LstToken, s: LstSettings): LstFont {
  switch (t.style) {
    case 'keyword':
    case 'texcs':
      return s.keywordstyle[(t.keywordClass ?? 1) - 1] ?? s.keywordstyle[0];
    case 'directive':
      return s.directivestyle ?? s.keywordstyle[0];
    case 'comment':
      return s.commentstyle;
    case 'string':
      return s.stringstyle;
    case 'identifier':
      return s.identifierstyle;
    default:
      return { unsupported: [] };
  }
}

/** One character, as its glyph or a visible-space mark. */
function glyph(c: string, tt: boolean) {
  if (c === VISIBLE_SPACE) return h('span', { class: 'lst-vs' });
  return tt ? (OT1_TT[c] ?? c) : ot1Roman(c);
}

export interface ListingLines {
  lines: HElement[];
  /** The next line number (for firstnumber=last). */
  next: number;
}

/** Lay out `code` as listing lines (\lstlisting) starting at `first`. */
export function listingLines(
  code: string,
  s: LstSettings,
  lang: LstLanguage | null,
  first: number
): ListingLines {
  const rows = lstLines(code, lang, {
    tabsize: s.tabsize,
    showstringspaces: s.showstringspaces,
  });
  const lines = rows.map((tokens, i) => {
    const n = first + i;
    const children: (HElement | string)[] = [];
    if (s.numbers !== 'none' && n % s.stepnumber === 0)
      children.push(
        h(
          'span',
          {
            class: [
              'lst-num',
              ...(s.numbers === 'right' ? ['right'] : []),
              ...fontClasses(s.numberstyle),
            ].join(' '),
          },
          [String(n)]
        )
      );
    children.push(...lineUnits(tokens, s));
    return h('p', { class: 'lst-line' }, children);
  });
  return { lines, next: first + rows.length };
}

/** \lstinline: the same units, inline. */
export function inlineListing(
  code: string,
  s: LstSettings,
  lang: LstLanguage | null
): HElement {
  const [tokens = []] = lstLines(code.replace(/\n/g, ' '), lang, {
    tabsize: s.tabsize,
    showstringspaces: s.showstringspaces,
  });
  // listings.sty: \lstinline does \lstset{flexiblecolumns,…}.
  const inline: LstSettings =
    s.columns === 'fixed' ? { ...s, columns: 'flexible' } : s;
  return h(
    'span',
    { class: ['lstinline', ...fontClasses(s.basicstyle)].join(' ') },
    lineUnits(tokens, inline)
  );
}

function lineUnits(tokens: LstToken[], s: LstSettings): (HElement | string)[] {
  const out: (HElement | string)[] = [];
  // basewidth is in TeX's em, the basic font's quad (\fontdimen6).
  const basic = metricsOf(s.basicstyle);
  if (s.columns === 'fixed') {
    const column = s.basewidth * basic.quad;
    for (const t of tokens) {
      const width = em(t.text.length * column);
      if (t.kind === 'space') {
        out.push(h('span', { class: 'lst-sp', style: `width: ${width}` }));
        continue;
      }
      const font = styleFont(t, s);
      const chars = [...t.text];
      const tokenTt = (font.family ?? s.basicstyle.family) === 'tt';
      // \lst@FillFixed: \hss between the characters, and before and after
      // them for [c] (after for [l], before for [r]); all \hss share the
      // box's spare width equally, negative when the characters overflow.
      const n = chars.length;
      const spare =
        n * column - naturalWidth(t.text, metricsOf(font, s.basicstyle));
      const gap = spare / (s.align === 'c' ? n + 1 : n);
      out.push(
        h(
          'span',
          {
            class: ['lst-u', ...fontClasses(font, s.basicstyle)].join(' '),
            style: `width: ${width}`,
          },
          chars.map((c, i) => {
            const before = i === 0 && s.align === 'l' ? 0 : gap;
            return h(
              'span',
              Math.abs(before) < 5e-5
                ? {}
                : { style: `margin-left: ${em(before)}` },
              [glyph(c, tokenTt)]
            );
          })
        )
      );
    }
    return out;
  }

  // Flexible columns: \lst@lostspace bookkeeping, in em.
  const bw = s.basewidthFlexible * basic.quad;
  let lost = 0;
  let atStart = true;
  let spaceUnitDone = false;
  const kern = () => {
    if (lost > 1e-9 && (s.columns !== 'fullflexible' || atStart)) {
      out.push(h('span', { class: 'lst-sp', style: `width: ${em(lost)}` }));
      lost = 0;
    }
  };
  for (const t of tokens) {
    if (t.kind === 'space') {
      for (let k = 0; k < t.text.length; k++) {
        if (!atStart && !spaceUnitDone) {
          // The first space after a unit: \lst@outputspace, a font space.
          kern();
          out.push(' ');
          lost += bw - basic.space;
          spaceUnitDone = true;
        } else lost += bw;
      }
      continue;
    }
    kern();
    atStart = false;
    spaceUnitDone = false;
    const font = styleFont(t, s);
    const tokenTt = (font.family ?? s.basicstyle.family) === 'tt';
    const chars = [...t.text];
    out.push(
      h(
        'span',
        { class: ['lst-f', ...fontClasses(font, s.basicstyle)].join(' ') },
        chars.some((c) => c === VISIBLE_SPACE)
          ? chars.map((c) => glyph(c, tokenTt))
          : [chars.map((c) => glyph(c, tokenTt)).join('')]
      )
    );
    lost +=
      chars.length * bw - naturalWidth(t.text, metricsOf(font, s.basicstyle));
  }
  return out;
}
