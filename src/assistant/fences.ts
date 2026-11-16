/**
 * A reply split into prose and fenced code blocks (```lang … ```), so code
 * can be shown as code with a Copy button. Text only: nothing is parsed as
 * HTML or Markdown beyond the fences. Pure.
 */
export type Segment =
  { kind: 'text'; text: string } | { kind: 'code'; lang: string; text: string };

export function splitFences(reply: string): Segment[] {
  const out: Segment[] = [];
  let rest = reply;
  while (rest) {
    const open = /(^|\n)```([^\n`]*)\n/.exec(rest);
    if (!open) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    const before = rest.slice(0, open.index + open[1].length);
    if (before) out.push({ kind: 'text', text: before });
    const body = rest.slice(open.index + open[0].length);
    const close = /\n```[ \t]*(?=\n|$)/.exec(body);
    out.push({
      kind: 'code',
      lang: open[2].trim(),
      text: close ? body.slice(0, close.index) : body,
    });
    rest = close ? body.slice(close.index + close[0].length) : '';
  }
  return out;
}
