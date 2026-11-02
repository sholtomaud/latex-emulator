import type { Range } from '../source.ts';

export type TokenType =
  | 'command'
  | 'text'
  | 'space'
  | 'parbreak'
  | 'comment'
  | 'begin-group'
  | 'end-group'
  | 'math-shift'
  | 'special'
  | 'verb'
  | 'verbatim';

export interface Token {
  type: TokenType;
  /**
   * command: the name without the backslash; verb/verbatim: the raw content;
   * everything else: the raw source text.
   */
  value: string;
  /** Exact source text of the whole token. */
  raw: string;
  range: Range;
  /** \verb* / verbatim* */
  star?: boolean;
  /** \verb or verbatim with no closing delimiter. */
  unterminated?: boolean;
  /** verbatim: the environment name ('verbatim', 'verbatim*', 'lstlisting'). */
  env?: string;
  /** verb: the command ('verb' or 'lstinline'). */
  name?: string;
  /** lstlisting / \lstinline: the raw [key=value] options. */
  options?: string;
}

const LETTER = /[A-Za-z@]/;
const WHITESPACE = /[ \t\r\n]/;
/** Characters that end a run of plain text (TeX catcodes other than letter/other). */
const TEXT_STOP = /[\\{}$&#^_~% \t\r\n[\]]/;
const SPECIALS = new Set(['&', '#', '^', '_', '~']);
const VERBATIM_ENVS = ['verbatim*', 'verbatim', 'lstlisting'];

/**
 * Split LaTeX source into tokens. Lossless: concatenating every token's `raw`
 * reproduces the input exactly, so every later stage can map back to ranges.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  const push = (
    type: TokenType,
    start: number,
    end: number,
    value = src.slice(start, end),
    extra: Partial<Token> = {}
  ) => {
    tokens.push({
      type,
      value,
      raw: src.slice(start, end),
      range: { start, end },
      ...extra,
    });
    pos = end;
  };

  while (pos < src.length) {
    const start = pos;
    const ch = src[pos];

    if (ch === '\\') {
      if (
        lexVerbatim(src, start, push) ||
        lexVerb(src, start, push) ||
        lexLstinline(src, start, push)
      )
        continue;
      let end = start + 1;
      if (end < src.length && LETTER.test(src[end])) {
        while (end < src.length && LETTER.test(src[end])) end++;
      } else if (end < src.length) {
        end++; // control symbol: exactly one character
      }
      push('command', start, end, src.slice(start + 1, end));
    } else if (ch === '{') {
      push('begin-group', start, start + 1);
    } else if (ch === '}') {
      push('end-group', start, start + 1);
    } else if (ch === '$') {
      push('math-shift', start, start + 1);
    } else if (SPECIALS.has(ch)) {
      push('special', start, start + 1);
    } else if (ch === '%') {
      // A comment eats the rest of the line, its newline, and the next
      // line's leading spaces (TeX skips them in state N).
      let end = src.indexOf('\n', start);
      if (end === -1) end = src.length;
      else {
        end++;
        while (end < src.length && (src[end] === ' ' || src[end] === '\t'))
          end++;
      }
      push('comment', start, end);
    } else if (WHITESPACE.test(ch)) {
      let end = start;
      let newlines = 0;
      while (end < src.length && WHITESPACE.test(src[end])) {
        if (src[end] === '\n') newlines++;
        end++;
      }
      const atLineStart = start === 0 || src[start - 1] === '\n';
      const isPar = newlines >= 2 || (newlines >= 1 && atLineStart);
      push(isPar ? 'parbreak' : 'space', start, end);
    } else if (ch === '[' || ch === ']') {
      // Own token so the parser can find optional arguments without splitting.
      push('text', start, start + 1);
    } else {
      let end = start + 1;
      while (end < src.length && !TEXT_STOP.test(src[end])) end++;
      push('text', start, end);
    }
  }
  return tokens;
}

type Push = (
  type: TokenType,
  start: number,
  end: number,
  value?: string,
  extra?: Partial<Token>
) => void;

/** \verb<d>…<d> and \verb*<d>…<d>. Returns true if it consumed a token. */
function lexVerb(src: string, start: number, push: Push): boolean {
  if (!src.startsWith('\\verb', start)) return false;
  let p = start + 5;
  if (p < src.length && LETTER.test(src[p])) return false; // e.g. \verbatim
  const star = src[p] === '*';
  if (star) p++;
  const delim = src[p];
  if (delim === undefined || delim === '\n') return false;
  const contentStart = p + 1;
  let close = contentStart;
  while (close < src.length && src[close] !== delim && src[close] !== '\n')
    close++;
  const terminated = src[close] === delim;
  const end = terminated ? close + 1 : close;
  push('verb', start, end, src.slice(contentStart, close), {
    star,
    name: 'verb',
    unterminated: !terminated,
  });
  return true;
}

/**
 * `[options]` at `p` (balanced braces, so `caption={a [b] c}` works), as
 * listings reads them: returns the text and the position after `]`.
 */
function bracketOptions(
  src: string,
  p: number
): { text: string; end: number } | null {
  if (src[p] !== '[') return null;
  let depth = 0;
  for (let q = p + 1; q < src.length; q++) {
    const c = src[q];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ']' && depth <= 0)
      return { text: src.slice(p + 1, q), end: q + 1 };
    else if (c === '\n' && src[q + 1] === '\n') return null;
  }
  return null;
}

/**
 * \lstinline[opts]<d>…<d> or \lstinline[opts]{…} (listings reads a
 * braced argument up to the next `}`). Returns true if it consumed a token.
 */
function lexLstinline(src: string, start: number, push: Push): boolean {
  if (!src.startsWith('\\lstinline', start)) return false;
  let p = start + 10;
  if (p < src.length && LETTER.test(src[p])) return false;
  const opts = bracketOptions(src, p);
  if (opts) p = opts.end;
  const delim = src[p];
  if (delim === undefined || delim === '\n') return false;
  const closer = delim === '{' ? '}' : delim;
  const contentStart = p + 1;
  let close = contentStart;
  while (close < src.length && src[close] !== closer && src[close] !== '\n')
    close++;
  const terminated = src[close] === closer;
  push(
    'verb',
    start,
    terminated ? close + 1 : close,
    src.slice(contentStart, close),
    {
      name: 'lstinline',
      ...(opts ? { options: opts.text } : {}),
      unterminated: !terminated,
    }
  );
  return true;
}

/** \begin{verbatim}…\end{verbatim}, captured raw. */
function lexVerbatim(src: string, start: number, push: Push): boolean {
  for (const env of VERBATIM_ENVS) {
    const open = `\\begin{${env}}`;
    if (!src.startsWith(open, start)) continue;
    let contentStart = start + open.length;
    // listings: [options], then the rest of the \begin line is dropped.
    const opts =
      env === 'lstlisting' ? bracketOptions(src, contentStart) : null;
    if (opts) contentStart = opts.end;
    if (env === 'lstlisting') {
      const eol = src.indexOf('\n', contentStart);
      const closing = src.indexOf(`\\end{${env}}`, contentStart);
      if (eol !== -1 && (closing === -1 || eol < closing)) contentStart = eol;
    }
    const closeTag = `\\end{${env}}`;
    const close = src.indexOf(closeTag, contentStart);
    const terminated = close !== -1;
    const contentEnd = terminated ? close : src.length;
    // Like LaTeX, drop the newline that directly follows \begin{verbatim}.
    const bodyStart =
      src[contentStart] === '\n' ? contentStart + 1 : contentStart;
    push(
      'verbatim',
      start,
      terminated ? close + closeTag.length : src.length,
      src.slice(Math.min(bodyStart, contentEnd), contentEnd),
      {
        env,
        star: env.endsWith('*'),
        unterminated: !terminated,
        ...(opts ? { options: opts.text } : {}),
      }
    );
    return true;
  }
  return false;
}
