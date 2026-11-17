/** How tool calls and results read in the conversation (ADR 0025). Pure. */
import type { ChatMessage, ToolCall } from './providers.ts';

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const value = (v: unknown): string =>
  typeof v === 'string'
    ? `“${cut(v, 60)}”`
    : Array.isArray(v)
      ? `[${v.map(value).join(', ')}]`
      : JSON.stringify(v);

/** `zettel_create(title: “…”, sources: [“…”])` */
export function callLine(call: ToolCall): string {
  const args = Object.entries(call.input)
    .map(([k, v]) => `${k}: ${value(v)}`)
    .join(', ');
  return `${call.name}(${args})`;
}

/** `→ result` or `✗ error`, at most 160 characters. */
export function resultLine(m: Extract<ChatMessage, { role: 'tool' }>): string {
  return `${m.isError ? '✗' : '→'} ${cut(m.content.replace(/\s+/g, ' '), 160)}`;
}
