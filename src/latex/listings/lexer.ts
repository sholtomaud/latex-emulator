/**
 * listings' lexer (listings.sty, lstmisc.sty): splits code into lines of
 * output units, as listings forms them, each with the style it gets.
 *
 * - Letters are A–Z, a–z, @, $ and _ (\lst@ProcessLetter); a digit joins a
 *   run of letters, otherwise it is "other" (\lst@ProcessDigit). A run of
 *   letters and a run of other characters are each one output unit
 *   (\lst@AppendLetter / \lst@AppendOther); in fixed columns a unit of n
 *   characters fills n columns.
 * - Comments and strings use the language's delimiters (longest first).
 *   Inside them, units still split by character class, styled as comment
 *   or string. [b] strings escape with a backslash, [d] by doubling, [m]
 *   (Matlab) only after something that is not a name or closing bracket.
 *   [l] comments and [b]/[d]/[m] strings end with the line.
 * - Tabs move to the next multiple of tabsize; spaces in strings become
 *   visible spaces (U+2423 in the text) when showstringspaces is on
 *   (listings' default).
 * Pure: no DOM.
 */
import type { Delimited, LstLanguage } from './language-types.ts';

export type LstStyle =
  | 'plain'
  | 'identifier'
  | 'keyword'
  | 'comment'
  | 'string'
  | 'directive'
  | 'texcs';

export interface LstToken {
  kind: 'letter' | 'other' | 'space';
  text: string;
  style: LstStyle;
  /** keywords=[n] (texcs=[n]) class, for keywordstyle=[n]. */
  keywordClass?: number;
}

export interface LstLexOptions {
  tabsize: number;
  showstringspaces: boolean;
}

/** Stands for listings' visible space in a token's text. */
export const VISIBLE_SPACE = '\u2423';
const LETTER = /[A-Za-z@$_]/;
const DIGIT = /[0-9]/;
/** listings ends these at the end of a line. */
const LINE_STRINGS = new Set(['b', 'd', 'bd', 'm']);

function expandTabs(line: string, tabsize: number): string {
  let out = '';
  for (const c of line)
    out += c === '\t' ? ' '.repeat(tabsize - (out.length % tabsize)) : c;
  return out;
}

type Mode = null | { type: 'comment' | 'string'; d: Delimited; depth: number };

export function lstLines(
  code: string,
  lang: LstLanguage | null,
  options: LstLexOptions
): LstToken[][] {
  const text = code.replace(/\r\n?/g, '\n');
  const raw = text.split('\n');
  if (text.endsWith('\n')) raw.pop();
  const fold = (w: string) => (lang?.sensitive ? w : w.toLowerCase());
  const keywords = new Map<string, number>();
  lang?.keywords.forEach((words, i) =>
    words.forEach((w) => keywords.has(fold(w)) || keywords.set(fold(w), i + 1))
  );
  const texcs = new Map<string, number>();
  lang?.texcs.forEach((words, i) =>
    words.forEach((w) => texcs.has(w) || texcs.set(w, i + 1))
  );
  const directives = new Set(lang?.directives.map(fold));
  const delimiters = [
    ...(lang?.comments ?? []).map((d) => ({ type: 'comment' as const, d })),
    ...(lang?.strings ?? []).map((d) => ({ type: 'string' as const, d })),
  ].sort((a, b) => b.d.open.length - a.d.open.length);

  let mode: Mode = null;
  return raw.map((rawLine) => {
    const line = expandTabs(rawLine, options.tabsize);
    if (
      mode &&
      (mode.d.kind === 'l' ||
        (mode.type === 'string' && LINE_STRINGS.has(mode.d.kind)))
    )
      mode = null;
    const tokens: LstToken[] = [];

    /** Add one character, extending the last unit when it has the same class. */
    const add = (c: string, style: LstStyle) => {
      const last = tokens.at(-1);
      if (c === ' ') {
        // listings appends \lst@visiblespace as an "other" character.
        if (style === 'string' && options.showstringspaces) {
          add(VISIBLE_SPACE, style);
          return;
        }
        if (last?.kind === 'space') last.text += c;
        else tokens.push({ kind: 'space', text: c, style: 'plain' });
        return;
      }
      const kind =
        LETTER.test(c) ||
        (DIGIT.test(c) && last?.kind === 'letter' && last.style === style)
          ? 'letter'
          : 'other';
      if (last && last.kind === kind && last.style === style) last.text += c;
      else tokens.push({ kind, text: c, style });
    };
    const addAll = (s: string, style: LstStyle) => {
      for (const c of s) add(c, style);
    };
    const prevSignificant = (i: number) => {
      let j = i - 1;
      while (j >= 0 && line[j] === ' ') j--;
      return j < 0 ? '' : line[j];
    };

    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (mode) {
        const { d } = mode;
        const style = mode.type;
        if (mode.type === 'string') {
          if ((d.kind === 'b' || d.kind === 'bd') && c === '\\') {
            addAll(line.slice(i, i + 2), style);
            i += 2;
            continue;
          }
          if (line.startsWith(d.close, i)) {
            const doubled =
              (d.kind === 'd' || d.kind === 'bd' || d.kind === 'm') &&
              line.startsWith(d.close, i + d.close.length);
            const n = d.close.length * (doubled ? 2 : 1);
            addAll(line.slice(i, i + n), style);
            i += n;
            if (!doubled) mode = null;
            continue;
          }
        } else if (d.kind !== 'l') {
          if (d.kind === 'n' && line.startsWith(d.open, i)) {
            mode.depth++;
            addAll(d.open, style);
            i += d.open.length;
            continue;
          }
          if (line.startsWith(d.close, i)) {
            addAll(d.close, style);
            i += d.close.length;
            if (--mode.depth === 0) mode = null;
            continue;
          }
        }
        add(c, style);
        i++;
        continue;
      }

      // A directive: its character first on the line, then a directive name.
      if (lang?.directiveChar === c && line.slice(0, i).trim() === '') {
        const m = /^[A-Za-z]+/.exec(line.slice(i + 1));
        if (m && directives.has(fold(m[0]))) {
          add(c, 'directive');
          addAll(m[0], 'directive');
          i += 1 + m[0].length;
          continue;
        }
      }
      const opener = delimiters.find(
        ({ d }) =>
          line.startsWith(d.open, i) &&
          !(d.kind === 'm' && /[A-Za-z0-9_)\].'"]/.test(prevSignificant(i)))
      );
      if (opener) {
        mode = { type: opener.type, d: opener.d, depth: 1 };
        addAll(opener.d.open, opener.type);
        i += opener.d.open.length;
        continue;
      }
      // A TeX control sequence: \ and its letters, one unit.
      if (
        c === '\\' &&
        lang?.texcs.length &&
        /[A-Za-z@]/.test(line[i + 1] ?? '')
      ) {
        const name = /^[A-Za-z@]+/.exec(line.slice(i + 1))![0];
        const n = texcs.get(name);
        tokens.push({
          kind: 'letter',
          text: `\\${name}`,
          style: n ? 'texcs' : 'identifier',
          ...(n ? { keywordClass: n } : {}),
        });
        i += 1 + name.length;
        continue;
      }
      add(
        c,
        LETTER.test(c) || (DIGIT.test(c) && tokens.at(-1)?.kind === 'letter')
          ? 'identifier'
          : 'plain'
      );
      i++;
    }

    for (const t of tokens)
      if (
        t.kind === 'letter' &&
        t.style === 'identifier' &&
        !t.text.startsWith('\\')
      ) {
        const n = keywords.get(fold(t.text));
        if (n) {
          t.style = 'keyword';
          t.keywordClass = n;
        }
      }
    return tokens;
  });
}
