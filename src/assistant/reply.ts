/**
 * A streamed reply put together (ADR 0025): the text as it arrives, then
 * the tool calls and, for Claude, its content blocks as they came (thinking
 * and its signature included), which a tool loop must send back unchanged.
 * Pure: SSE `data:` payloads in, pieces out.
 */
import { streamEvent } from './providers.ts';
import type { StreamEvent, ToolCall } from './providers.ts';

export interface Reply {
  text: string;
  toolCalls: ToolCall[];
  /** Claude only: its content blocks, to send back as they are. */
  blocks?: unknown[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Arguments as an object; anything else is passed on for the tool to refuse. */
function parseInput(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const v: unknown = JSON.parse(json);
    if (isRecord(v)) return v;
  } catch {
    // Fall through.
  }
  return { _invalidArguments: json };
}

interface Partial {
  id: string;
  name: string;
  json: string;
  extra?: Record<string, unknown>;
}

export class ReplyAssembler {
  private api: 'anthropic' | 'openai';
  private text = '';
  /** Claude's blocks by index; tool_use inputs are filled in at the end. */
  private blocks: Record<string, unknown>[] = [];
  private calls: Partial[] = [];
  private claudeCalls = new Map<number, Partial>();

  constructor(api: 'anthropic' | 'openai') {
    this.api = api;
  }

  /** One SSE payload: text to show, the end, or an error. */
  feed(data: string): StreamEvent {
    const event = streamEvent(
      this.api === 'anthropic' ? 'anthropic' : 'local',
      data
    );
    if (event.text) this.text += event.text;
    if (event.error || event.done) return event;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return event;
    }
    if (!isRecord(json)) return event;
    if (this.api === 'anthropic') this.claude(json);
    else this.openai(json);
    return event;
  }

  private claude(e: Record<string, unknown>) {
    const index = typeof e.index === 'number' ? e.index : -1;
    if (e.type === 'content_block_start' && isRecord(e.content_block)) {
      const block = { ...e.content_block };
      this.blocks[index] = block;
      if (block.type === 'tool_use')
        this.claudeCalls.set(index, {
          id: String(block.id ?? ''),
          name: String(block.name ?? ''),
          json: '',
        });
      return;
    }
    if (e.type !== 'content_block_delta' || !isRecord(e.delta)) return;
    const block = this.blocks[index];
    if (!block) return;
    const d = e.delta;
    if (d.type === 'text_delta')
      block.text = String(block.text ?? '') + String(d.text ?? '');
    else if (d.type === 'thinking_delta')
      block.thinking = String(block.thinking ?? '') + String(d.thinking ?? '');
    else if (d.type === 'signature_delta')
      block.signature =
        String(block.signature ?? '') + String(d.signature ?? '');
    else if (d.type === 'input_json_delta') {
      const call = this.claudeCalls.get(index);
      if (call) call.json += String(d.partial_json ?? '');
    }
  }

  private openai(e: Record<string, unknown>) {
    const choice = Array.isArray(e.choices) ? e.choices[0] : undefined;
    if (!isRecord(choice) || !isRecord(choice.delta)) return;
    const pieces = choice.delta.tool_calls;
    if (!Array.isArray(pieces)) return;
    for (const p of pieces) {
      if (!isRecord(p)) continue;
      const i = typeof p.index === 'number' ? p.index : this.calls.length;
      const fn = isRecord(p.function) ? p.function : {};
      const call = (this.calls[i] ??= { id: '', name: '', json: '' });
      if (typeof p.id === 'string' && p.id) call.id = p.id;
      if (typeof fn.name === 'string' && fn.name) call.name = fn.name;
      if (typeof fn.arguments === 'string') call.json += fn.arguments;
      // Gemini's thought signature: it must come back with the call.
      if (isRecord(p.extra_content)) call.extra = p.extra_content;
    }
  }

  result(): Reply {
    if (this.api === 'anthropic') {
      // Each tool_use block gets its input, put together from the deltas.
      const blocks = this.blocks.flatMap((b, index) => {
        if (!b) return [];
        const call = this.claudeCalls.get(index);
        return [call ? { ...b, input: parseInput(call.json) } : b];
      });
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: String(b.id),
          name: String(b.name),
          input: b.input as Record<string, unknown>,
        }));
      return { text: this.text, toolCalls, blocks };
    }
    return {
      text: this.text,
      toolCalls: this.calls.filter(Boolean).map((c, i) => ({
        // Some local servers leave the id out: make one, unique here.
        id: c.id || `call_${i}`,
        name: c.name,
        input: parseInput(c.json),
        ...(c.extra ? { extra: c.extra } : {}),
      })),
    };
  }
}
