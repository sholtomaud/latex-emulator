/** key=value lists, as keyval reads them (graphicx, listings). Pure. */

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
