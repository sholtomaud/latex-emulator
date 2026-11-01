/**
 * \includegraphics options, as graphicx applies them (graphicx.sty,
 * \Gin@esetsize). Size keys given before `angle` scale the image itself;
 * `angle` then turns it, and size keys after it scale the turned box.
 * `keepaspectratio` applies wherever it is written. Pure: sizes in bp.
 */
import { parseLength } from './lengths.ts';
import type { LengthContext } from './lengths.ts';

export type Keyval = [key: string, value: string | null];

/** "a=1, b={x,y}, c" → [['a','1'], ['b','x,y'], ['c', null]]. */
export function parseKeyval(text: string): Keyval[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of text) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  return parts
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p): Keyval => {
      const eq = p.indexOf('=');
      if (eq < 0) return [p, null];
      const value = p.slice(eq + 1).trim();
      return [
        p.slice(0, eq).trim(),
        /^\{.*\}$/.test(value) ? value.slice(1, -1) : value,
      ];
    });
}

export interface GraphicsBox {
  /** The box the image occupies on the page, after any rotation (bp). */
  width: number;
  height: number;
  /** Clockwise quarter turns are counter-clockwise in TeX: 0, 90, 180, 270. */
  rotate: 0 | 90 | 180 | 270;
  draft: boolean;
  /** Keys we ignore (unsupported), as written. */
  problems: string[];
}

/** No natural size known (a missing image, a compressed PDF): 1in × 0.75in. */
const UNKNOWN = { width: 72, height: 54 };
const UNSUPPORTED = new Set([
  'trim',
  'clip',
  'viewport',
  'page',
  'bb',
  'bbllx',
  'bblly',
  'bburx',
  'bbury',
  'hiresbb',
  'origin',
  'pagebox',
  'interpolate',
]);

export function graphicsBox(
  options: Keyval[],
  natural: { width: number; height: number } | null,
  ctx: LengthContext
): GraphicsBox {
  const problems: string[] = [];
  let draft = false;
  const keepAspect = options.some(([k]) => k === 'keepaspectratio');
  const nat = { ...natural };
  for (const [key, value] of options) {
    if (key !== 'natwidth' && key !== 'natheight') continue;
    const v = value === null ? null : parseLength(value, ctx);
    if (v === null) problems.push(`${key}=${value ?? ''}`);
    else nat[key === 'natwidth' ? 'width' : 'height'] = v;
  }
  const known = nat.width !== undefined && nat.height !== undefined;
  let box = known ? { width: nat.width!, height: nat.height! } : { ...UNKNOWN };
  let rotate: GraphicsBox['rotate'] = 0;
  let pending: { width?: number; height?: number; scale?: number } = {};

  const apply = () => {
    const { width, height, scale } = pending;
    if (scale !== undefined)
      box = { width: box.width * scale, height: box.height * scale };
    if (width !== undefined && height !== undefined) {
      if (keepAspect && known) {
        const s = Math.min(width / box.width, height / box.height);
        box = { width: box.width * s, height: box.height * s };
      } else box = { width, height };
    } else if (width !== undefined)
      box = { width, height: (box.height * width) / box.width };
    else if (height !== undefined)
      box = { width: (box.width * height) / box.height, height };
    pending = {};
  };

  for (const [key, value] of options) {
    const raw = value === null ? key : `${key}=${value}`;
    if (key === 'width' || key === 'height' || key === 'totalheight') {
      const v = value === null ? null : parseLength(value, ctx);
      if (v === null) problems.push(raw);
      else pending[key === 'width' ? 'width' : 'height'] = v;
    } else if (key === 'scale') {
      const v = Number(value);
      if (value === null || !Number.isFinite(v)) problems.push(raw);
      else pending.scale = v;
    } else if (key === 'angle') {
      const a = Number(value);
      const turn = (((a % 360) + 360) % 360) as number;
      if (value === null || !Number.isFinite(a) || turn % 90 !== 0) {
        problems.push(raw);
        continue;
      }
      apply();
      rotate = ((rotate + turn) % 360) as GraphicsBox['rotate'];
      if (turn % 180 !== 0) box = { width: box.height, height: box.width };
    } else if (key === 'draft') draft = value !== 'false';
    else if (key === 'final') draft = false;
    else if (
      key !== 'keepaspectratio' &&
      key !== 'natwidth' &&
      key !== 'natheight'
    )
      problems.push(UNSUPPORTED.has(key) ? key : raw);
  }
  apply();
  return { width: box.width, height: box.height, rotate, draft, problems };
}
