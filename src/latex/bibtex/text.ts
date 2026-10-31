/**
 * BibTeX's text built-ins (change.case$, purify$, text.length$,
 * text.prefix$, add.period$, substring$), following bibtex.web.
 *
 * A "special character" is a brace group at brace level 0 that starts with a
 * backslash, e.g. {\"O}. BibTeX treats it as a single character.
 */

const isAlpha = (c: string) => /[A-Za-z]/.test(c);
const isNumeric = (c: string) => /[0-9]/.test(c);
export const isWhite = (c: string) => c === ' ' || c === '\t' || c === '\n';

/** Control sequences BibTeX knows as foreign letters. */
const FOREIGN_LOWER = new Set(['i', 'j', 'oe', 'ae', 'aa', 'o', 'l', 'ss']);
const FOREIGN_UPPER = new Set(['OE', 'AE', 'AA', 'O', 'L']);

/** End index (exclusive) of the special character whose "{" is at `start`. */
function specialEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i + 1;
  }
  return s.length;
}

const isSpecialAt = (s: string, i: number, depth: number) =>
  s[i] === '{' && depth === 0 && s[i + 1] === '\\';

/** text.length$: characters, with each special character counting once. */
export function textLength(s: string): number {
  let n = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      if (isSpecialAt(s, i, depth)) {
        i = specialEnd(s, i) - 1;
        n++;
      } else depth++;
    } else if (c === '}') {
      if (depth > 0) depth--;
    } else n++;
  }
  return n;
}

/** text.prefix$: the first `n` text characters, braces kept balanced. */
export function textPrefix(s: string, n: number): string {
  let count = 0;
  let depth = 0;
  let i = 0;
  while (i < s.length && count < n) {
    const c = s[i];
    if (c === '{') {
      if (isSpecialAt(s, i, depth)) {
        i = specialEnd(s, i);
        count++;
        continue;
      }
      depth++;
    } else if (c === '}') {
      if (depth > 0) depth--;
    } else count++;
    i++;
  }
  return s.slice(0, i) + '}'.repeat(depth);
}

/** purify$: letters, digits and spaces only (as BibTeX sorts and labels). */
export function purify(s: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (isWhite(c) || c === '-' || c === '~') out += ' ';
    else if (isAlpha(c) || isNumeric(c)) out += c;
    else if (c === '{') {
      if (isSpecialAt(s, i, depth)) {
        const end = specialEnd(s, i);
        let j = i + 1;
        let inner = 1;
        while (j < end - 1) {
          if (s[j] === '\\') {
            j++;
            const csStart = j;
            while (j < end && isAlpha(s[j])) j++;
            const cs = s.slice(csStart, j);
            // Foreign letters keep their letters (\ae → ae), except
            // \aa/\AA, which purify to a single a/A (as real bibtex).
            if (cs === 'aa' || cs === 'AA') out += cs[0];
            else if (FOREIGN_LOWER.has(cs) || FOREIGN_UPPER.has(cs)) out += cs;
            continue;
          }
          if (s[j] === '{') inner++;
          else if (s[j] === '}') inner--;
          else if (isAlpha(s[j]) || isNumeric(s[j])) out += s[j];
          j++;
        }
        i = end - 1;
      } else depth++;
    } else if (c === '}') {
      if (depth > 0) depth--;
    }
  }
  return out;
}

export type CaseSpec = 't' | 'l' | 'u';

/** change.case$ with BibTeX's rules for braces, colons and special characters. */
export function changeCase(s: string, spec: string): string {
  const mode = spec.toLowerCase() as CaseSpec;
  if (mode !== 't' && mode !== 'l' && mode !== 'u') return s;
  const lower = mode !== 'u';
  const conv = (c: string) => (lower ? c.toLowerCase() : c.toUpperCase());
  let out = '';
  let depth = 0;
  let prevColon = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      if (depth === 0 && s[i + 1] === '\\') {
        // Special character: convert its letters (not command names, except
        // foreign letters), unless title case protects this position.
        const end = specialEnd(s, i);
        const keep =
          mode === 't' && (i === 0 || (prevColon && isWhite(s[i - 1] ?? '')));
        if (keep) out += s.slice(i, end);
        else out += convertSpecial(s.slice(i, end), mode);
        i = end - 1;
        prevColon = false;
        continue;
      }
      // Ordinary brace group at level 0: copied unchanged.
      if (depth === 0) {
        let j = i;
        let d = 0;
        for (; j < s.length; j++) {
          if (s[j] === '{') d++;
          else if (s[j] === '}' && --d === 0) break;
        }
        out += s.slice(i, j + 1);
        i = j;
        prevColon = false;
        continue;
      }
      depth++;
      out += c;
    } else if (c === '}') {
      if (depth > 0) depth--;
      out += c;
      prevColon = false;
    } else if (depth > 0) {
      out += c;
    } else {
      if (mode === 't') {
        const protectedPos = i === 0 || (prevColon && isWhite(s[i - 1]));
        out += protectedPos ? c : conv(c);
        if (c === ':') prevColon = true;
        else if (!isWhite(c)) prevColon = false;
      } else out += conv(c);
    }
  }
  return out;
}

function convertSpecial(special: string, mode: CaseSpec): string {
  let out = '';
  let i = 0;
  while (i < special.length) {
    const c = special[i];
    if (c === '\\') {
      let j = i + 1;
      while (j < special.length && isAlpha(special[j])) j++;
      const cs = special.slice(i + 1, j);
      let name = cs;
      if (mode === 'u') {
        if (FOREIGN_LOWER.has(cs)) {
          if (cs === 'i' || cs === 'j' || cs === 'ss') name = cs.toUpperCase();
          else name = cs.toUpperCase();
        }
      } else if (FOREIGN_UPPER.has(cs)) name = cs.toLowerCase();
      // \i, \j, \ss in upper case lose the backslash: I, J, SS.
      if (mode === 'u' && (cs === 'i' || cs === 'j' || cs === 'ss'))
        out += name;
      else out += '\\' + name;
      i = j;
      continue;
    }
    if (isAlpha(c)) out += mode === 'u' ? c.toUpperCase() : c.toLowerCase();
    else out += c;
    i++;
  }
  return out;
}

/** add.period$: adds "." unless the text already ends in . ? or !. */
export function addPeriod(s: string): string {
  let i = s.length - 1;
  while (i >= 0 && s[i] === '}') i--;
  if (i < 0) return s;
  return '.?!'.includes(s[i]) ? s : s + '.';
}

/** substring$ (1-based start; negative counts from the end). */
export function substring(s: string, start: number, len: number): string {
  const n = s.length;
  if (len <= 0 || start === 0 || Math.abs(start) > n) return '';
  if (start > 0) return s.slice(start - 1, start - 1 + len);
  const end = n + start + 1;
  return s.slice(Math.max(0, end - len), end);
}
