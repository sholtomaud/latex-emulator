/**
 * Generate src/latex/listings/languages.ts from TeX Live's listings language
 * files (lstlang1–3.sty, LPPL; definitions by their named authors). It
 * resolves each curated language's dialect inheritance and keeps what the
 * emulator's lexer uses: keyword classes, case sensitivity, comments,
 * strings, C directives and TeX control sequences.
 *
 *   node scripts/make-lst-languages.ts
 *
 * Needs TeX Live (kpsewhich). The output is committed, so CI does not.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_DIALECTS } from '../src/latex/listings/language-types.ts';
import type {
  Delimited,
  LstLanguage,
} from '../src/latex/listings/language-types.ts';

/** As users write them; dialects in [], default dialects per listings.cfg. */
export const CURATED = [
  'Python',
  '[ANSI]C',
  '[ISO]C++',
  'Java',
  'R',
  'Matlab',
  'Octave',
  'bash',
  'sh',
  'SQL',
  '[plain]TeX',
  '[LaTeX]TeX',
  'Haskell',
  'Ruby',
  'Perl',
  'PHP',
  'Go',
  '[95]Fortran',
];

interface Def {
  dialect: string;
  name: string;
  base?: { dialect: string; name: string };
  body: string;
}

/** Remove TeX comments (unescaped % to end of line, and the newline). */
export function stripComments(tex: string): string {
  return tex.replace(/(?<!\\)%[^\n]*\n[ \t]*/g, '');
}

/** The balanced {group} at `p`: its content and the index after it. */
function group(s: string, p: number): { text: string; end: number } | null {
  if (s[p] !== '{') return null;
  let depth = 0;
  for (let q = p; q < s.length; q++) {
    if (s[q] === '\\') {
      q++;
      continue;
    }
    if (s[q] === '{') depth++;
    else if (s[q] === '}' && --depth === 0)
      return { text: s.slice(p + 1, q), end: q + 1 };
  }
  return null;
}

function bracket(s: string, p: number): { text: string; end: number } | null {
  if (s[p] !== '[') return null;
  const q = s.indexOf(']', p);
  return q < 0 ? null : { text: s.slice(p + 1, q), end: q + 1 };
}

const skipWs = (s: string, p: number) => {
  while (/\s/.test(s[p] ?? '')) p++;
  return p;
};

export function parseDefinitions(tex: string): Def[] {
  const out: Def[] = [];
  const src = stripComments(tex);
  const re = /\\lst@definelanguage/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let p = skipWs(src, m.index + m[0].length);
    const d = bracket(src, p);
    if (d) p = skipWs(src, d.end);
    const n = group(src, p);
    if (!n) continue;
    p = skipWs(src, n.end);
    let base: Def['base'];
    const bd = bracket(src, p);
    if (bd) {
      const bn = group(src, skipWs(src, bd.end));
      if (!bn) continue;
      base = { dialect: bd.text.trim(), name: bn.text.trim() };
      p = skipWs(src, bn.end);
    }
    const body = group(src, p);
    if (!body) continue;
    out.push({
      dialect: d?.text.trim() ?? '',
      name: n.text.trim(),
      base,
      body: body.text,
    });
  }
  return out;
}

/** Split at top-level commas. */
function topLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      cur += c + (s[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts.map((x) => x.trim()).filter(Boolean);
}

/** TeX text of a delimiter: `\#` → #, a braced group → its content. */
function unescape(s: string): string {
  let t = s.trim();
  if (t.startsWith('{') && t.endsWith('}')) t = t.slice(1, -1);
  return t.replace(/\\(.)/g, '$1').replace(/\\\\/g, '\\');
}

/** e.g. `[s]{/-*}{*-/}` (block), `[l]\#` (line), `[b]"` → kind, open, close. */
function delimited(value: string): Delimited | null {
  const b = bracket(value, 0);
  if (!b) return null;
  const kind = b.text.replace(/\*/g, '');
  const rest = value.slice(b.end).trim();
  if (rest.startsWith('{')) {
    const a = group(rest, 0)!;
    const c = group(rest, skipWs(rest, a.end));
    return {
      kind,
      open: unescape(a.text),
      close: c ? unescape(c.text) : unescape(a.text),
    };
  }
  const open = unescape(rest);
  return { kind, open, close: open };
}

function words(s: string): string[] {
  const g = s.trim().startsWith('{') ? group(s.trim(), 0)!.text : s;
  return g
    .split(',')
    .map((w) => w.trim().replace(/\\(.)/g, '$1'))
    .filter(Boolean);
}

function classOf(value: string): { n: number; rest: string } {
  const b = bracket(value.trim(), 0);
  return b
    ? { n: Number(b.text) || 1, rest: value.trim().slice(b.end) }
    : { n: 1, rest: value };
}

export function apply(lang: LstLanguage, body: string): void {
  for (const part of topLevel(body)) {
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).trim();
    const value = eq < 0 ? '' : part.slice(eq + 1).trim();
    const kw = (n: number) => (lang.keywords[n - 1] ??= []);
    const cs = (n: number) => (lang.texcs[n - 1] ??= []);
    switch (key) {
      case 'sensitive':
        lang.sensitive = value === '' || value === 'true' || value === 't';
        break;
      case 'keywords':
      case 'morekeywords':
      case 'ndkeywords':
      case 'morendkeywords': {
        const { n, rest } = classOf(value);
        const cls = key.includes('nd') ? 2 : n;
        if (key === 'keywords' || key === 'ndkeywords')
          lang.keywords[cls - 1] = [];
        kw(cls).push(...words(rest));
        break;
      }
      case 'deletekeywords': {
        const { n, rest } = classOf(value);
        const drop = new Set(words(rest));
        lang.keywords[n - 1] = kw(n).filter((w) => !drop.has(w));
        break;
      }
      case 'texcs':
      case 'moretexcs': {
        const { n, rest } = classOf(value);
        if (key === 'texcs') lang.texcs[n - 1] = [];
        cs(n).push(...words(rest));
        break;
      }
      case 'directives':
      case 'moredirectives':
        if (key === 'directives') lang.directives = [];
        lang.directives.push(...words(value));
        break;
      case 'moredelim':
        if (/\[directive\]/.test(value))
          lang.directiveChar = unescape(value.replace(/^\*?\[directive\]/, ''));
        break;
      case 'comment':
      case 'morecomment': {
        if (key === 'comment') lang.comments = [];
        const d = delimited(value);
        if (d && ['l', 's', 'n'].includes(d.kind)) lang.comments.push(d);
        break;
      }
      case 'string':
      case 'morestring': {
        if (key === 'string') lang.strings = [];
        const d = delimited(value);
        if (d && ['b', 'd', 'bd', 's', 'm'].includes(d.kind))
          lang.strings.push(d);
        break;
      }
    }
  }
}

export function resolve(
  defs: Def[],
  dialect: string,
  name: string,
  seen = new Set<string>()
): LstLanguage {
  const lower = name.toLowerCase();
  const want = (dialect || DEFAULT_DIALECTS[lower] || '').toLowerCase();
  const def = defs.find(
    (d) => d.name.toLowerCase() === lower && d.dialect.toLowerCase() === want
  );
  if (!def) throw new Error(`No listings definition for [${want}]${name}`);
  const key = `[${want}]${lower}`;
  if (seen.has(key)) throw new Error(`Cycle at ${key}`);
  seen.add(key);
  const lang: LstLanguage = def.base
    ? structuredClone(resolve(defs, def.base.dialect, def.base.name, seen))
    : {
        sensitive: false,
        keywords: [],
        texcs: [],
        directives: [],
        comments: [],
        strings: [],
      };
  apply(lang, def.body);
  return lang;
}

if (import.meta.main) {
  const files = ['lstlang1.sty', 'lstlang2.sty', 'lstlang3.sty'].map((f) =>
    execFileSync('kpsewhich', [f], { encoding: 'utf8' }).trim()
  );
  const defs = files.flatMap((f) =>
    parseDefinitions(readFileSync(f, 'latin1'))
  );
  const out: Record<string, LstLanguage> = {};
  for (const spec of CURATED) {
    const m = /^(?:\[([^\]]*)\])?(.+)$/.exec(spec)!;
    const lang = resolve(defs, m[1] ?? '', m[2]);
    const name = m[2].toLowerCase();
    const dialect = (m[1] || DEFAULT_DIALECTS[name] || '').toLowerCase();
    out[dialect ? `[${dialect}]${name}` : name] = lang;
  }
  const version = execFileSync('kpsewhich', ['listings.sty'], {
    encoding: 'utf8',
  }).trim();
  const header = `/**
 * Generated by scripts/make-lst-languages.ts from TeX Live's listings
 * language files (${version.replace(/listings\.sty$/, 'lstlang*.sty')},
 * LPPL 1.3; each definition's authors are named there). Do not edit.
 */
import type { LstLanguage } from './language-types.ts';

/** Keyed by [dialect]name in lower case (language-types.ts: DEFAULT_DIALECTS). */
export const LANGUAGES: Record<string, LstLanguage> = ${JSON.stringify(out, null, 2)};

`;
  writeFileSync(
    new URL('../src/latex/listings/languages.ts', import.meta.url),
    header
  );
  console.log(`wrote ${Object.keys(out).length} languages`);
}
