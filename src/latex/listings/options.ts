/**
 * listings' settings: defaults from listings.sty and lstmisc.sty, changed
 * by \lstset, \lstdefinestyle + style=, and a listing's own [options], in
 * the order written. Pure: lengths stay as written (the renderer converts
 * them), styles become font switches.
 */
import { parseKeyval } from '../keyval.ts';
import { DEFAULT_DIALECTS } from './language-types.ts';

/** A style value such as `\ttfamily\small` as font switches. */
export interface LstFont {
  family?: 'rm' | 'sf' | 'tt';
  series?: 'bf' | 'md';
  shape?: 'it' | 'sl' | 'sc' | 'up';
  /** A size command name, e.g. 'small'. */
  size?: string;
  /** Commands we can't apply (e.g. \color without xcolor support). */
  unsupported: string[];
}

export interface LstSettings {
  /** LANGUAGES key, e.g. 'python' or '[iso]c++'; null for none. */
  language: string | null;
  /** The language as written, for messages. */
  languageName?: string;
  basicstyle: LstFont;
  /** keywordstyle=[n]: index n−1; classes without one use [0]. */
  keywordstyle: LstFont[];
  commentstyle: LstFont;
  stringstyle: LstFont;
  identifierstyle: LstFont;
  directivestyle: LstFont | null;
  numberstyle: LstFont;
  numbers: 'none' | 'left' | 'right';
  numbersep: string;
  stepnumber: number;
  firstnumber: number | 'auto';
  frame: 'none' | 'single' | 'lines' | 'topline' | 'bottomline' | 'leftline';
  framesep: string;
  framerule: string;
  columns: 'fixed' | 'flexible' | 'fullflexible' | 'spaceflexible';
  /** columns=[c|l|r]: where a unit's characters sit in fixed columns. */
  align: 'c' | 'l' | 'r';
  /** basewidth (fixed columns), in em. */
  basewidth: number;
  /** basewidth's second value (flexible columns), in em. */
  basewidthFlexible: number;
  showstringspaces: boolean;
  tabsize: number;
  caption?: string;
  title?: string;
  label?: string;
  captionpos: 't' | 'b';
  xleftmargin: string;
  xrightmargin: string;
  /** Keys or values we ignore, as written. */
  problems: string[];
}

const FAMILY = { ttfamily: 'tt', rmfamily: 'rm', sffamily: 'sf' } as const;
const SERIES = { bfseries: 'bf', mdseries: 'md' } as const;
const SHAPE = {
  itshape: 'it',
  slshape: 'sl',
  scshape: 'sc',
  upshape: 'up',
} as const;
const SIZES = new Set([
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
]);

export function parseFontStyle(tex: string): LstFont {
  const font: LstFont = { unsupported: [] };
  for (const m of tex.matchAll(/\\([A-Za-z]+)/g)) {
    const name = m[1];
    if (name in FAMILY) font.family = FAMILY[name as keyof typeof FAMILY];
    else if (name in SERIES) font.series = SERIES[name as keyof typeof SERIES];
    else if (name in SHAPE) font.shape = SHAPE[name as keyof typeof SHAPE];
    else if (SIZES.has(name)) font.size = name;
    else if (name !== 'normalfont') font.unsupported.push(`\\${name}`);
  }
  return font;
}

/** `language=…` → LANGUAGES key: [dialect]name, lower case. */
export function languageKey(value: string): string {
  const v = value
    .trim()
    .replace(/^\{(.*)\}$/, '$1')
    .trim();
  const m = /^(?:\[([^\]]*)\])?\s*(.+)$/.exec(v)!;
  const name = m[2].trim().toLowerCase();
  const dialect = (m[1]?.trim() || DEFAULT_DIALECTS[name] || '').toLowerCase();
  return dialect ? `[${dialect}]${name}` : name;
}

export const DEFAULT_LST: LstSettings = {
  language: null,
  basicstyle: { unsupported: [] },
  // lstmisc.sty: \lst@Key{keywordstyle}{\bfseries}
  keywordstyle: [{ series: 'bf', unsupported: [] }],
  // lstmisc.sty: \lst@AddToHook{EmptyStyle}{\let\lst@commentstyle\itshape}
  commentstyle: { shape: 'it', unsupported: [] },
  stringstyle: { unsupported: [] },
  identifierstyle: { unsupported: [] },
  directivestyle: null,
  numberstyle: { unsupported: [] },
  numbers: 'none',
  numbersep: '10pt',
  stepnumber: 1,
  firstnumber: 'auto',
  frame: 'none',
  framesep: '3pt',
  framerule: '.4pt',
  // listings.sty: columns=[c]fixed, basewidth={0.6em,0.45em}
  columns: 'fixed',
  align: 'c',
  basewidth: 0.6,
  basewidthFlexible: 0.45,
  showstringspaces: true,
  tabsize: 8,
  captionpos: 't',
  xleftmargin: '0pt',
  xrightmargin: '0pt',
  problems: [],
};

const unbrace = (v: string) => v.trim().replace(/^\{([\s\S]*)\}$/, '$1');
const FRAMES = new Set([
  'none',
  'single',
  'lines',
  'topline',
  'bottomline',
  'leftline',
]);
const COLUMNS = new Set(['fixed', 'flexible', 'fullflexible', 'spaceflexible']);

/** Apply `key=value` options in order; `styles` holds \lstdefinestyle bodies. */
export function applyLstOptions(
  base: LstSettings,
  options: string,
  styles: ReadonlyMap<string, string>,
  depth = 0
): LstSettings {
  let s: LstSettings = {
    ...base,
    keywordstyle: [...base.keywordstyle],
    problems: depth === 0 ? [] : base.problems,
  };
  const problem = (p: string) => s.problems.push(p);
  const font = (key: string, value: string) => {
    const f = parseFontStyle(value);
    if (f.unsupported.length) problem(`${key}: ${f.unsupported.join(', ')}`);
    return f;
  };
  for (const [key, raw] of parseKeyval(options)) {
    const value = raw ?? '';
    const bad = () => problem(`${key}=${value}`);
    switch (key) {
      case 'language':
        s.language = languageKey(value);
        s.languageName = unbrace(value).trim();
        break;
      case 'style': {
        const body = styles.get(value.trim());
        if (body === undefined || depth > 8) bad();
        else s = applyLstOptions(s, body, styles, depth + 1);
        break;
      }
      case 'basicstyle':
      case 'commentstyle':
      case 'stringstyle':
      case 'identifierstyle':
      case 'numberstyle':
        s[key] = font(key, value);
        break;
      case 'directivestyle':
        s.directivestyle = font(key, value);
        break;
      case 'keywordstyle': {
        const m = /^\s*\[(\d+)\]([\s\S]*)$/.exec(value);
        const n = m ? Number(m[1]) : 1;
        s.keywordstyle[n - 1] = font(key, m ? m[2] : value);
        break;
      }
      case 'numbers':
        if (value === 'none' || value === 'left' || value === 'right')
          s.numbers = value;
        else bad();
        break;
      case 'numbersep':
      case 'framesep':
      case 'framerule':
      case 'xleftmargin':
      case 'xrightmargin':
        s[key] = unbrace(value);
        break;
      case 'stepnumber':
      case 'tabsize': {
        const n = Number(value);
        if (Number.isInteger(n) && n > 0) s[key] = n;
        else bad();
        break;
      }
      case 'firstnumber': {
        const n = Number(value);
        if (value === 'auto') s.firstnumber = 'auto';
        else if (Number.isInteger(n)) s.firstnumber = n;
        else bad();
        break;
      }
      case 'frame':
        if (FRAMES.has(value)) s.frame = value as LstSettings['frame'];
        else bad();
        break;
      case 'columns': {
        const m = /^(?:\[([clr])\])?(\w+)$/.exec(value.trim());
        if (m && COLUMNS.has(m[2])) {
          s.columns = m[2] as LstSettings['columns'];
          if (m[1]) s.align = m[1] as LstSettings['align'];
        } else bad();
        break;
      }
      case 'flexiblecolumns':
        s.columns = value === 'false' ? 'fixed' : 'flexible';
        break;
      case 'basewidth': {
        const ems = unbrace(value)
          .split(',')
          .map((v) => /^\s*([\d.]+)em\s*$/.exec(v)?.[1]);
        if (ems[0] === undefined) bad();
        else {
          s.basewidth = Number(ems[0]);
          s.basewidthFlexible = Number(ems[1] ?? ems[0]);
        }
        break;
      }
      case 'showstringspaces':
        s.showstringspaces = value !== 'false';
        break;
      case 'caption': {
        const v = value.trim();
        // caption=[short]{long}
        const m = /^\[[^\]]*\]\s*\{([\s\S]*)\}$/.exec(v);
        s.caption = m ? m[1] : unbrace(v);
        s.title = undefined;
        break;
      }
      case 'title':
        s.title = unbrace(value);
        s.caption = undefined;
        break;
      case 'label':
        s.label = unbrace(value).trim();
        break;
      case 'captionpos':
        if (value === 't' || value === 'b') s.captionpos = value;
        else bad();
        break;
      // No visible effect in a document set in one place (floats stay
      // where written, ADR 0012) or on Unicode input.
      case 'float':
      case 'floatplacement':
      case 'name':
      case 'extendedchars':
      case 'inputencoding':
        break;
      default:
        problem(key);
    }
  }
  return s;
}
