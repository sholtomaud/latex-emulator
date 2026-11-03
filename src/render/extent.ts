/**
 * The height and depth of a line of rendered content, as TeX's \hbox of it
 * would have them, in em of its font size: the tallest and deepest glyph,
 * from the Computer Modern TFMs (src/latex/listings/cm-metrics.ts).
 *
 * CSS line boxes are always the same size, but TeX boxes are as tall as
 * their glyphs. That matters where a rule stops interline glue: after an
 * \hrule (\prevdepth −1000pt) the next line's baseline sits its height
 * below, and the rule after a line sits its depth below (ADR 0016). Pure.
 */
import { CM_METRICS } from '../latex/listings/cm-metrics.ts';
import type { HChild } from './hnode.ts';

export interface Extent {
  height: number;
  depth: number;
}

/** Font classes the renderer uses, to cm-metrics keys. */
const FONT_CLASSES: Record<string, string> = {
  bf: 'bf',
  it: 'it',
  em: 'it',
  sl: 'sl',
  sc: 'sc',
  tt: 'tt',
  sf: 'sf',
  rm: 'rm',
  normalfont: 'rm',
};

/**
 * Non-ASCII characters: [height, depth] in em. Text: OT1 slots of cmr10.
 * Math: cmsy10 and cmmi10 (tftopl), with \ne as \not= (the slash's box).
 */
const OTHER: Record<string, [number, number]> = {
  '’': [0.6944, 0],
  '‘': [0.6944, 0],
  '“': [0.6944, 0],
  '”': [0.6944, 0],
  '–': [0.4306, 0],
  '—': [0.4306, 0],
  '←': [0.3669, 0], // cmsy10 '40: 0.366875, −0.133125
  '→': [0.3669, 0],
  '≥': [0.636, 0.136], // cmsy10 '25 and '24
  '≤': [0.636, 0.136],
  '≠': [0.6944, 0.1944], // cmsy10 '66 \not
  '×': [0.5833, 0.0833],
  '±': [0.5833, 0.0833],
  '⋅': [0.4444, 0],
  '∈': [0.5391, 0.0391],
  '∞': [0.4306, 0],
  '▷': [0.4653, 0], // cmmi10 '56: 0.465279, −0.034721
  '◁': [0.4653, 0],
  '−': [0.5833, 0.0833], // cmsy10 '0, as × and ±
};

/** An x-height box: what an unknown character is taken to be. */
const UNKNOWN: [number, number] = [0.4306, 0];

/** cmsy10 \fontdimen16 (sub1) and \fontdimen14 (sup2), in em. */
const SUB1 = 0.15;
const SUP2 = 0.3629;
/** TeX's \scriptstyle size in \textstyle (size1x.clo: 8pt of 10.95, ≈ 0.7). */
const SCRIPT = 0.7;
const X_HEIGHT = 0.4306;

function charExtent(ch: string, font: string): [number, number] {
  const code = ch.charCodeAt(0);
  const m = CM_METRICS[font] ?? CM_METRICS.rm;
  if (code >= 33 && code <= 126)
    return [m.heights[code - 32], m.depths[code - 32]];
  if (/\s/.test(ch)) return [0, 0];
  return OTHER[ch] ?? UNKNOWN;
}

function text(s: string, font: string, into: Extent) {
  for (const ch of s) {
    const [h, d] = charExtent(ch, font);
    into.height = Math.max(into.height, h);
    into.depth = Math.max(into.depth, d);
  }
}

function walk(nodes: HChild[], font: string, mathMode: boolean, into: Extent) {
  for (const n of nodes) {
    if (typeof n === 'string') {
      text(n, font, into);
      continue;
    }
    if (n.tag === 'math') {
      walk(n.children, 'rm', true, into);
      continue;
    }
    if (mathMode) {
      if (n.tag === 'mi') {
        // A single letter is math italic; a name (\sin, mod) is roman.
        const s = n.children.join('');
        text(
          s,
          [...s].length === 1 && n.attrs.mathvariant !== 'normal' ? 'mi' : 'rm',
          into
        );
        continue;
      }
      if (n.tag === 'msub' || n.tag === 'msup' || n.tag === 'msubsup') {
        const [base, ...scripts] = n.children;
        walk([base], font, true, into);
        const box = (c: HChild): Extent => {
          const e = { height: 0, depth: 0 };
          walk([c], font, true, e);
          return { height: e.height * SCRIPT, depth: e.depth * SCRIPT };
        };
        const sub = n.tag === 'msup' ? null : box(scripts[0]);
        const sup = n.tag === 'msub' ? null : box(scripts.at(-1)!);
        if (sub) {
          // TeX (Appendix G, 18b): down max(sub1, h(sub) − ⁴⁄₅ x-height).
          const shift = Math.max(SUB1, sub.height - 0.8 * X_HEIGHT);
          into.depth = Math.max(into.depth, sub.depth + shift);
          into.height = Math.max(into.height, sub.height - shift);
        }
        if (sup) {
          // 18c: up max(sup2, d(sup) + ¼ x-height) in text style.
          const shift = Math.max(SUP2, sup.depth + 0.25 * X_HEIGHT);
          into.height = Math.max(into.height, sup.height + shift);
          into.depth = Math.max(into.depth, sup.depth - shift);
        }
        continue;
      }
      // mo, mn, mrow, mtext…: their characters in roman (cmr digits and
      // brackets; OTHER for the symbols).
      walk(n.children, 'rm', true, into);
      continue;
    }
    const cls = (n.attrs.class ?? '').split(' ').find((c) => c in FONT_CLASSES);
    walk(n.children, cls ? FONT_CLASSES[cls] : font, false, into);
  }
}

/** The extent of `nodes`, set in `font` (a cm-metrics key; roman by default). */
export function boxExtent(nodes: HChild[], font = 'rm'): Extent {
  const into = { height: 0, depth: 0 };
  walk(nodes, font, false, into);
  return into;
}

/**
 * The natural width of `s` in em, from the TFM advance widths (kerns are
 * not counted). A tie (U+00A0) is the font's interword space, as TeX's ~.
 * The browser rounds each glyph's advance to a whole pixel, so a label set
 * in a box of this width puts the text after it where TeX does.
 */
export function textWidth(s: string, font = 'rm'): number {
  const m = CM_METRICS[font] ?? CM_METRICS.rm;
  let width = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === ' ' || ch === ' ') width += m.space;
    else if (code >= 33 && code <= 126) width += m.widths[code - 32];
    else width += 0.5;
  }
  return width;
}
