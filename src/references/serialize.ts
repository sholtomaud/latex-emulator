/** A BibTeX entry as data, and its canonical text form. Pure; no DOM. */

export interface BibField {
  /** Lower-case field name. */
  name: string;
  /** BibTeX value without outer delimiters (already escaped). */
  value: string;
  /** A macro name such as `oct`, written unbraced. */
  macro?: boolean;
}

export interface BibEntryData {
  /** Lower-case entry type, e.g. "article". */
  type: string;
  fields: BibField[];
}

/** `@type{key,\n  name = {value},\n}` with one field per line. */
export function serializeEntry(key: string, entry: BibEntryData): string {
  const lines = entry.fields.map(
    (f) => `  ${f.name} = ${f.macro ? f.value : `{${f.value}}`},`
  );
  return `@${entry.type}{${key},\n${lines.join('\n')}\n}\n`;
}
