/**
 * Placeholder "renderer" used until the real parser and renderer land
 * (roadmap steps 3–4). It is deliberately naive and pure — no DOM — so it can
 * be unit-tested under `node --test`. Delete it once `src/latex/parser` exists.
 */

const BEGIN_DOCUMENT = '\\begin{document}';
const END_DOCUMENT = '\\end{document}';

/** Strip `%` comments, honouring the `\%` escape. */
export function stripComments(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++; // skip the escaped character
    } else if (line[i] === '%') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** The text between `\begin{document}` and `\end{document}`, or all of it. */
export function documentBody(source: string): string {
  const start = source.indexOf(BEGIN_DOCUMENT);
  if (start === -1) return source;
  const bodyStart = start + BEGIN_DOCUMENT.length;
  const end = source.indexOf(END_DOCUMENT, bodyStart);
  return source.slice(bodyStart, end === -1 ? undefined : end);
}

/**
 * Split LaTeX source into paragraphs the way TeX does: a blank line (or a
 * line containing only a comment) ends a paragraph, and runs of whitespace
 * inside a paragraph collapse to one space.
 */
export function toPlainParagraphs(source: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join(' ').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
    current = [];
  };

  for (const rawLine of documentBody(source).split(/\r?\n/)) {
    const isCommentOnly = /^\s*%/.test(rawLine);
    const line = stripComments(rawLine);
    if (line.trim() === '') {
      if (!isCommentOnly) flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return paragraphs;
}
