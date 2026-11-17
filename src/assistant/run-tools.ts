/**
 * The tool loop (ADR 0025), shared by the chat and the reviewer: stream a
 * reply; if the model called tools, run each, send the results back, and
 * go on, for at most MAX_ROUNDS rounds. Pure: fetch and the tools are
 * passed in.
 */
import { streamReply } from './chat-client.ts';
import { buildChatRequest } from './providers.ts';
import type {
  ChatMessage,
  ProviderConfig,
  ToolCall,
  ToolDef,
} from './providers.ts';

export interface LoopTools {
  definitions(): ToolDef[];
  run(call: ToolCall): Promise<{ content: string; isError?: true }>;
}

/** An error, with what to do when it is a known one. */
export const withHint = (error: string) =>
  /jinja/i.test(error)
    ? `${error} Start llama-server with --jinja and a model that calls tools, or turn tools off for it in Assistant setup.`
    : error;

/** Rounds of tool calls in one answer, at most. */
export const MAX_ROUNDS = 10;

/** Every tool call answered, as Claude's API requires of a conversation. */
export function answerOpenCalls(
  history: ChatMessage[],
  why: string
): ChatMessage[] {
  const out = [...history];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== 'assistant') continue;
    const answered = new Set(
      out
        .slice(i + 1)
        .filter((x) => x.role === 'tool')
        .map((x) => (x as { callId: string }).callId)
    );
    for (const call of m.toolCalls ?? [])
      if (!answered.has(call.id))
        out.push({
          role: 'tool',
          callId: call.id,
          name: call.name,
          content: why,
          isError: true,
        });
    break;
  }
  return out;
}

export interface LoopOptions {
  cfg: ProviderConfig;
  system: string;
  history: ChatMessage[];
  /** null: a plain reply, no tools offered. */
  tools: LoopTools | null;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  signal: AbortSignal;
  /** The conversation so far, and the reply arriving now. */
  onUpdate?: (history: ChatMessage[], live: string) => void;
}

export interface LoopResult {
  /** The conversation, with the reply cut off by an error or Stop kept. */
  history: ChatMessage[];
  toolsRan: boolean;
  /** Why it failed ('' when it didn't, or was stopped). */
  error: string;
  stopped: boolean;
}

export async function runToolLoop(o: LoopOptions): Promise<LoopResult> {
  const definitions = o.tools?.definitions() ?? [];
  let history = o.history;
  let toolsRan = false;
  let error = '';
  let live = '';
  const show = () => o.onUpdate?.(history, live);
  try {
    for (let round = 0; ; round++) {
      live = '';
      const reply = await streamReply(
        o.cfg.provider,
        buildChatRequest(o.cfg, o.system, history, definitions),
        { fetch: o.fetch, signal: o.signal },
        (t) => {
          live += t;
          show();
        }
      );
      history = [
        ...history,
        {
          role: 'assistant',
          content: reply.text,
          ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}),
          ...(reply.blocks ? { blocks: reply.blocks } : {}),
        },
      ];
      live = '';
      show();
      if (!o.tools || !reply.toolCalls.length) break;
      if (round >= MAX_ROUNDS) {
        history = answerOpenCalls(history, 'Not run: too many rounds.');
        history.push({
          role: 'assistant',
          content: `[Stopped after ${MAX_ROUNDS} rounds of tool calls.]`,
        });
        break;
      }
      for (const call of reply.toolCalls) {
        if (o.signal.aborted) break;
        const result = await o.tools.run(call);
        toolsRan = true;
        history = [
          ...history,
          {
            role: 'tool',
            callId: call.id,
            name: call.name,
            content: result.content,
            ...(result.isError ? { isError: true } : {}),
          },
        ];
        show();
      }
      if (o.signal.aborted) break;
    }
  } catch (e) {
    if (!o.signal.aborted) error = e instanceof Error ? e.message : String(e);
  }
  if (live) history = [...history, { role: 'assistant', content: live }];
  return { history, toolsRan, error, stopped: o.signal.aborted };
}
