/**
 * BibTeX name handling: num.names$ and format.name$, following bibtex.web.
 */
import { isWhite } from './text.ts';

const isAlpha = (c: string) => /[A-Za-z]/.test(c);

/** Split a name list at " and " (case-insensitive, at brace level 0). */
export function splitNames(list: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (
      depth === 0 &&
      isWhite(c) &&
      /^and$/i.test(list.slice(i + 1, i + 4)) &&
      isWhite(list[i + 4] ?? '')
    ) {
      names.push(list.slice(start, i));
      i += 4;
      start = i + 1;
    }
  }
  names.push(list.slice(start));
  return names.map((n) => n.trim());
}

export function numNames(list: string): number {
  return splitNames(list).length;
}

interface Token {
  text: string;
  /** Separator before this token: ' ', '-' or '~'. */
  sep: string;
}

interface ParsedName {
  first: Token[];
  von: Token[];
  last: Token[];
  jr: Token[];
}

/** Break a single name into tokens and commas, as bibtex does. */
function tokenize(name: string): { tokens: Token[]; commas: number[] } {
  const tokens: Token[] = [];
  const commas: number[] = [];
  let i = 0;
  let current = '';
  let pendingSep = ' ';
  let inToken = false;
  const end = () => {
    if (inToken) tokens.push({ text: current, sep: pendingSep });
    current = '';
    inToken = false;
  };
  // Leading separators are ignored.
  while (
    i < name.length &&
    (isWhite(name[i]) || name[i] === '-' || name[i] === '~')
  )
    i++;
  while (i < name.length) {
    const c = name[i];
    if (c === ',') {
      end();
      if (commas.length < 2) commas.push(tokens.length);
      pendingSep = ' ';
      i++;
    } else if (c === '{') {
      let depth = 0;
      const start = i;
      for (; i < name.length; i++) {
        if (name[i] === '{') depth++;
        else if (name[i] === '}' && --depth === 0) break;
      }
      i++;
      current += name.slice(start, i);
      inToken = true;
    } else if (isWhite(c) || c === '-' || c === '~') {
      if (inToken) {
        end();
        pendingSep = isWhite(c) ? ' ' : c;
      }
      i++;
    } else {
      if (!inToken) inToken = true;
      current += c;
      i++;
    }
  }
  end();
  return { tokens, commas };
}

/** A token is "von" if its first letter (at brace level 0) is lower case. */
function isVon(token: string): boolean {
  let i = 0;
  while (i < token.length) {
    const c = token[i];
    if (isAlpha(c)) return c === c.toLowerCase();
    if (c === '{') {
      if (token[i + 1] === '\\') {
        // Special character: a foreign-letter command decides by its case,
        // otherwise the first letter inside it does.
        let j = i + 2;
        const csStart = j;
        while (j < token.length && isAlpha(token[j])) j++;
        const cs = token.slice(csStart, j);
        if (['oe', 'ae', 'aa', 'o', 'l', 'i', 'j', 'ss'].includes(cs))
          return true;
        if (['OE', 'AE', 'AA', 'O', 'L'].includes(cs)) return false;
        let depth = 1;
        for (; j < token.length && depth > 0; j++) {
          const d = token[j];
          if (isAlpha(d)) return d === d.toLowerCase();
          if (d === '{') depth++;
          else if (d === '}') depth--;
        }
        return false;
      }
      // Ordinary brace group: skipped.
      let depth = 0;
      for (; i < token.length; i++) {
        if (token[i] === '{') depth++;
        else if (token[i] === '}' && --depth === 0) break;
      }
    }
    i++;
  }
  return false;
}

function parseName(name: string): ParsedName {
  const { tokens, commas } = tokenize(name);
  const n = tokens.length;
  const slice = (a: number, b: number) => tokens.slice(a, b);
  /** von = from vonStart to the last von token before the last name's final token. */
  const vonEndFrom = (vonStart: number, lastEnd: number) => {
    let vonEnd = lastEnd - 1;
    while (vonEnd > vonStart) {
      if (isVon(tokens[vonEnd - 1].text)) break;
      vonEnd--;
    }
    return vonEnd;
  };

  if (commas.length === 0) {
    const lastEnd = n;
    let vonStart = 0;
    while (vonStart < lastEnd - 1 && !isVon(tokens[vonStart].text)) vonStart++;
    let vonEnd: number;
    if (vonStart < lastEnd - 1) vonEnd = vonEndFrom(vonStart, lastEnd);
    else {
      vonStart = Math.max(lastEnd - 1, 0);
      vonEnd = vonStart;
    }
    return {
      first: slice(0, vonStart),
      von: slice(vonStart, vonEnd),
      last: slice(vonEnd, lastEnd),
      jr: [],
    };
  }
  const lastEnd = commas[0];
  const jrEnd = commas.length === 2 ? commas[1] : lastEnd;
  const firstStart = jrEnd;
  const vonEnd = vonEndFrom(0, lastEnd);
  return {
    first: slice(firstStart, n),
    von: slice(0, vonEnd),
    last: slice(vonEnd, lastEnd),
    jr: slice(lastEnd, jrEnd),
  };
}

/** Text characters in `s` (braces don't count; a special char counts once). */
function textChars(s: string): number {
  let n = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      if (depth === 0 && s[i + 1] === '\\') {
        let d = 0;
        for (; i < s.length; i++) {
          if (s[i] === '{') d++;
          else if (s[i] === '}' && --d === 0) break;
        }
        n++;
        continue;
      }
      depth++;
    } else if (c === '}') depth--;
    else n++;
  }
  return n;
}

/** The abbreviation of a token: its first letter, or its first special char. */
function abbreviate(token: string): string {
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (isAlpha(c)) return c;
    if (c === '{' && token[i + 1] === '\\') {
      let d = 0;
      let j = i;
      for (; j < token.length; j++) {
        if (token[j] === '{') d++;
        else if (token[j] === '}' && --d === 0) break;
      }
      return token.slice(i, j + 1);
    }
  }
  return '';
}

/** format.name$: the `index`-th (1-based) name of `list`, formatted by `format`. */
export function formatName(
  list: string,
  index: number,
  format: string
): string {
  const names = splitNames(list);
  const name = names[index - 1];
  if (name === undefined) return '';
  const parts = parseName(name);
  const partFor: Record<string, Token[]> = {
    f: parts.first,
    v: parts.von,
    l: parts.last,
    j: parts.jr,
  };

  let out = '';
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c !== '{') {
      out += c;
      i++;
      continue;
    }
    // A top-level group: {pre-text letters [{sep}] post-text}
    let depth = 0;
    let j = i;
    for (; j < format.length; j++) {
      if (format[j] === '{') depth++;
      else if (format[j] === '}' && --depth === 0) break;
    }
    const group = format.slice(i + 1, j);
    i = j + 1;

    // Find the part letter at this group's own brace level.
    let k = 0;
    let d = 0;
    let letterAt = -1;
    for (; k < group.length; k++) {
      if (group[k] === '{') d++;
      else if (group[k] === '}') d--;
      else if (d === 0 && isAlpha(group[k])) {
        letterAt = k;
        break;
      }
    }
    if (letterAt === -1) {
      out += group;
      continue;
    }
    const letter = group[letterAt].toLowerCase();
    const tokens = partFor[letter] ?? [];
    if (tokens.length === 0) continue;
    const full = group[letterAt + 1]?.toLowerCase() === letter;
    let rest = letterAt + (full ? 2 : 1);
    // Any further letters of the same kind are skipped.
    while (rest < group.length && isAlpha(group[rest])) rest++;
    let explicitSep: string | null = null;
    if (group[rest] === '{') {
      let dd = 0;
      let m = rest;
      for (; m < group.length; m++) {
        if (group[m] === '{') dd++;
        else if (group[m] === '}' && --dd === 0) break;
      }
      explicitSep = group.slice(rest + 1, m);
      rest = m + 1;
    }
    const pre = group.slice(0, letterAt);
    let post = group.slice(rest);

    const groupStart = out.length;
    out += pre;
    tokens.forEach((t, idx) => {
      out += full ? t.text : abbreviate(t.text);
      if (idx === tokens.length - 1) return;
      if (explicitSep !== null) {
        out += explicitSep;
        return;
      }
      if (!full) out += '.';
      const next = tokens[idx + 1];
      if (next.sep === '-' || next.sep === '~') out += next.sep;
      else if (
        idx === tokens.length - 2 ||
        textChars(out.slice(groupStart)) < 3
      )
        out += '~';
      else out += ' ';
    });
    // A final ~ in the post-text is a discretionary tie: a space unless the
    // group's text so far is short.
    if (post.endsWith('~') && !post.endsWith('~~')) {
      post = post.slice(0, -1);
      out += post;
      out += textChars(out.slice(groupStart)) < 3 ? '~' : ' ';
    } else out += post;
  }
  return out;
}
