/**
 * A .bib reader with BibTeX 0.99's semantics (checked against real bibtex):
 * @string macros, # concatenation, whitespace compressed and trimmed,
 * duplicate keys keep the first entry, @comment only skips its own word.
 */

export interface BibEntry {
  /** Lower-case entry type, e.g. "article". */
  type: string;
  /** Key as written in the .bib file. */
  key: string;
  /** Lower-case field name → value (outer delimiters removed). */
  fields: Map<string, string>;
  /** Lower-case field name → its value exactly as written, e.g. `may`. */
  raw: Map<string, string>;
  /** Where the entry is in the source, from its `@` to its closing delimiter. */
  span: { start: number; end: number };
}

export interface ParsedBib {
  entries: BibEntry[];
  /** @string definitions, merged over the predefined macros. */
  macros: Map<string, string>;
  /** Concatenated @preamble contents. */
  preamble: string;
  warnings: string[];
}

const WHITE = /\s/;
/** Characters that cannot appear in BibTeX identifiers. */
const NOT_ID = /[\s"#%'(),={}]/;

export function parseBib(
  text: string,
  predefined: Map<string, string> = new Map()
): ParsedBib {
  const macros = new Map(predefined);
  const entries: BibEntry[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  let preamble = '';
  let pos = 0;

  const line = (at: number) => text.slice(0, at).split('\n').length;
  const skipWhite = () => {
    while (pos < text.length && WHITE.test(text[pos])) pos++;
  };
  const readId = (): string => {
    const start = pos;
    while (pos < text.length && !NOT_ID.test(text[pos])) pos++;
    return text.slice(start, pos);
  };

  class BibError extends Error {}
  const fail = (message: string): never => {
    throw new BibError(`${message} (line ${line(pos)})`);
  };

  /** One value: {…}, "…", a number, or a macro name. */
  const readToken = (): string => {
    skipWhite();
    const c = text[pos];
    if (c === '{') {
      let depth = 0;
      const start = pos + 1;
      for (; pos < text.length; pos++) {
        if (text[pos] === '{') depth++;
        else if (text[pos] === '}' && --depth === 0) break;
      }
      if (pos >= text.length) fail('Unbalanced braces');
      return text.slice(start, pos++);
    }
    if (c === '"') {
      let depth = 0;
      const start = ++pos;
      for (; pos < text.length; pos++) {
        if (text[pos] === '{') depth++;
        else if (text[pos] === '}') depth--;
        else if (text[pos] === '"' && depth === 0) break;
      }
      if (pos >= text.length) fail('Unterminated string');
      return text.slice(start, pos++);
    }
    if (c !== undefined && /\d/.test(c)) {
      const start = pos;
      while (pos < text.length && /\d/.test(text[pos])) pos++;
      return text.slice(start, pos);
    }
    const name = readId().toLowerCase();
    if (!name) fail('Expected a field value');
    if (!macros.has(name)) {
      warnings.push(`Warning--string name "${name}" is undefined`);
      return '';
    }
    return macros.get(name)!;
  };

  /** token # token # …, whitespace compressed as BibTeX does. */
  const readValue = (): string => {
    let value = readToken();
    skipWhite();
    while (text[pos] === '#') {
      pos++;
      value += readToken();
      skipWhite();
    }
    return value.replace(/\s+/g, ' ').trim();
  };

  while (pos < text.length) {
    const at = text.indexOf('@', pos);
    if (at === -1) break;
    pos = at + 1;
    skipWhite();
    const type = readId().toLowerCase();
    if (type === 'comment') continue; // only the word itself is skipped
    skipWhite();
    const open = text[pos];
    if (open !== '{' && open !== '(') continue;
    const close = open === '{' ? '}' : ')';
    pos++;
    const start = at;
    try {
      if (type === 'preamble') {
        preamble += readValue();
        skipWhite();
        if (text[pos] !== close) fail('Expected end of @preamble');
        pos++;
        continue;
      }
      if (type === 'string') {
        skipWhite();
        const name = readId().toLowerCase();
        skipWhite();
        if (text[pos] !== '=') fail('Expected = in @string');
        pos++;
        macros.set(name, readValue());
        skipWhite();
        if (text[pos] !== close) fail('Expected end of @string');
        pos++;
        continue;
      }
      skipWhite();
      const keyStart = pos;
      while (
        pos < text.length &&
        text[pos] !== ',' &&
        !WHITE.test(text[pos]) &&
        text[pos] !== close
      )
        pos++;
      const key = text.slice(keyStart, pos);
      const fields = new Map<string, string>();
      const raw = new Map<string, string>();
      for (;;) {
        skipWhite();
        if (text[pos] === close) {
          pos++;
          break;
        }
        if (text[pos] !== ',') fail(`Expected , or ${close} in entry ${key}`);
        pos++;
        skipWhite();
        if (text[pos] === close) {
          pos++;
          break;
        }
        const name = readId().toLowerCase();
        if (!name) fail(`Expected a field name in entry ${key}`);
        skipWhite();
        if (text[pos] !== '=') fail(`Expected = after ${name} in entry ${key}`);
        pos++;
        skipWhite();
        const valueStart = pos;
        const value = readValue();
        if (!fields.has(name)) {
          fields.set(name, value);
          raw.set(name, text.slice(valueStart, pos).trimEnd());
        }
      }
      if (seen.has(key.toLowerCase())) {
        warnings.push(`Repeated entry---line ${line(start)}: ${key}`);
        continue;
      }
      seen.add(key.toLowerCase());
      entries.push({ type, key, fields, raw, span: { start, end: pos } });
    } catch (error) {
      if (!(error instanceof BibError)) throw error;
      warnings.push(error.message);
      pos = Math.max(pos, start + 1);
    }
  }
  return { entries, macros, preamble, warnings };
}
