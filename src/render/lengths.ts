/**
 * TeX lengths (as written in \includegraphics options or p{…} columns) in
 * PostScript/CSS points. Pure; no DOM.
 */

export interface LengthContext {
  /** \textwidth (= \linewidth, \columnwidth in one-column text), in bp. */
  textwidth: number;
  em: number;
  ex: number;
}

/** bp per unit, from TeX's definitions (1in = 72.27pt = 72bp). */
const UNITS: Record<string, number> = {
  pt: 72 / 72.27,
  bp: 1,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  pc: (12 * 72) / 72.27,
  dd: ((1238 / 1157) * 72) / 72.27,
  cc: ((12 * 1238) / 1157) * (72 / 72.27),
  sp: 72 / 72.27 / 65536,
};

const WIDTHS = new Set(['textwidth', 'linewidth', 'columnwidth', 'hsize']);

/** A length in bp, or null when `text` isn't one. */
export function parseLength(text: string, ctx: LengthContext): number | null {
  const m =
    /^\s*([-+]?(?:\d+\.?\d*|\.\d+)?)\s*(?:([a-z]{2})|\\([a-z]+))\s*$/i.exec(
      text
    );
  if (!m) return null;
  const factor =
    m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  if (m[3] !== undefined)
    return WIDTHS.has(m[3]) ? factor * ctx.textwidth : null;
  if (m[1] === '') return null; // a unit needs a number
  const unit = m[2].toLowerCase();
  if (unit === 'em') return factor * ctx.em;
  if (unit === 'ex') return factor * ctx.ex;
  return UNITS[unit] !== undefined ? factor * UNITS[unit] : null;
}
