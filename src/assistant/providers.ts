/**
 * Model providers for the writing assistant (ADR 0023): what each request
 * looks like and how to read each streamed reply. Pure: requests are plain
 * data; `chat-client.ts` sends them.
 *
 * Two request shapes cover every provider: Anthropic's Messages API, and the
 * OpenAI-compatible chat completions API that OpenRouter, Gemini's
 * compatibility endpoint and llama.cpp's server all speak. Calls go out with
 * fetch, not an SDK: AGENTS.md §2 allows no runtime dependency but Monaco.
 */

export const PROVIDER_IDS = [
  'anthropic',
  'openrouter',
  'gemini',
  'local',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  name: string;
  /** Request and stream shape. */
  api: 'anthropic' | 'openai';
  baseUrl: string;
  /** '' when the user must pick one (or the server has only one). */
  defaultModel: string;
  needsKey: boolean;
  /** Where to get a key, shown in Assistant setup. */
  keyHelp: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    name: 'Claude (Anthropic)',
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5-5',
    needsKey: true,
    keyHelp: 'An API key from console.anthropic.com → API keys.',
  },
  openrouter: {
    name: 'OpenRouter',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    // OpenRouter's router picks a model for each request.
    defaultModel: 'openrouter/auto',
    needsKey: true,
    keyHelp: 'An API key from openrouter.ai → Keys.',
  },
  gemini: {
    name: 'Gemini (Google)',
    api: 'openai',
    // Gemini's OpenAI-compatible endpoint.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: '',
    needsKey: true,
    keyHelp: 'An API key from aistudio.google.com → Get API key.',
  },
  local: {
    name: 'Local server (llama.cpp)',
    api: 'openai',
    baseUrl: 'http://localhost:8080/v1',
    defaultModel: '',
    needsKey: false,
    keyHelp:
      'Optional: the key given to llama-server with --api-key. Any OpenAI-compatible server on this machine works (Ollama, LM Studio).',
  },
};

export interface ProviderConfig {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/** A tool the model may call (ADR 0025), its parameters as JSON Schema. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /**
   * The provider's own data on the call, sent back unchanged: Gemini's
   * `extra_content` (its thought signature) on OpenAI-compatible calls.
   */
  extra?: Record<string, unknown>;
}

/**
 * Gemini rejects a function call in the history without a thought
 * signature (HTTP 400). Calls saved before signatures were kept get the
 * placeholder Gemini documents for calls it didn't make; only the first
 * call of a turn carries one.
 */
const SKIP_SIGNATURE = {
  google: { thought_signature: 'skip_thought_signature_validator' },
};

/**
 * A conversation turn, the same for every provider. An assistant turn may
 * call tools; each call's result is a `tool` turn. `blocks` keeps Claude's
 * own content (thinking blocks included) to send back unchanged, as its
 * API requires in a tool loop.
 */
export type ChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      blocks?: unknown[];
    }
  | {
      role: 'tool';
      callId: string;
      name: string;
      content: string;
      isError?: boolean;
    };

/** Claude's messages: tool results go in a user turn, grouped. */
function anthropicMessages(messages: ChatMessage[]): unknown[] {
  const out: { role: string; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const content =
        m.blocks ??
        (m.toolCalls?.length
          ? [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.toolCalls.map((c) => ({
                type: 'tool_use',
                id: c.id,
                name: c.name,
                input: c.input,
              })),
            ]
          : m.content);
      if (content === '' || (Array.isArray(content) && !content.length))
        continue;
      out.push({ role: 'assistant', content });
    } else {
      const result = {
        type: 'tool_result',
        tool_use_id: m.callId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content))
        last.content.push(result);
      else out.push({ role: 'user', content: [result] });
    }
  }
  return out;
}

/** OpenAI-compatible messages: tool_calls with JSON arguments, tool turns. */
function openaiMessages(messages: ChatMessage[], gemini: boolean): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      if (!m.content && !m.toolCalls?.length) continue;
      out.push({
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c, i) => {
                const extra =
                  c.extra ?? (gemini && i === 0 ? SKIP_SIGNATURE : undefined);
                return {
                  id: c.id,
                  type: 'function',
                  function: {
                    name: c.name,
                    arguments: JSON.stringify(c.input),
                  },
                  ...(extra ? { extra_content: extra } : {}),
                };
              }),
            }
          : {}),
      });
    } else
      out.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
  }
  return out;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

/** The API version this code was written against (anthropic-version). */
const ANTHROPIC_VERSION = '2026-10-21';

/**
 * Models that accept server-side fallbacks: when the model declines, the API
 * re-runs the request on another model in the same call.
 */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

const trimSlash = (url: string) => url.replace(/\/+$/, '');

function anthropicHeaders(cfg: ProviderConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey ?? '',
    'anthropic-version': ANTHROPIC_VERSION,
    // Required for a call made from a web page with the user's own key.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function openaiHeaders(cfg: ProviderConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
  };
}

/** A streamed chat request: the system prompt and the conversation. */
export function buildChatRequest(
  cfg: ProviderConfig,
  system: string,
  messages: ChatMessage[],
  tools: ToolDef[] = []
): HttpRequest {
  const base = trimSlash(cfg.baseUrl);
  if (PROVIDERS[cfg.provider].api === 'anthropic') {
    const fallback = FALLBACK_MODELS.has(cfg.model);
    return {
      url: `${base}/v1/messages`,
      method: 'POST',
      headers: {
        ...anthropicHeaders(cfg),
        ...(fallback
          ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' }
          : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        // Streamed, so a long reply can't time out.
        max_tokens: 32000,
        stream: true,
        system,
        messages: anthropicMessages(messages),
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
        ...(fallback ? { fallbacks: 'default' } : {}),
      }),
    };
  }
  return {
    url: `${base}/chat/completions`,
    method: 'POST',
    headers: openaiHeaders(cfg),
    body: JSON.stringify({
      ...(cfg.model ? { model: cfg.model } : {}),
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...openaiMessages(messages, cfg.provider === 'gemini'),
      ],
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            })),
          }
        : {}),
      // llama.cpp reuses the cached prompt (the fixed instructions first).
      ...(cfg.provider === 'local' ? { cache_prompt: true } : {}),
    }),
  };
}

/** The provider's list of models. */
export function buildModelsRequest(cfg: ProviderConfig): HttpRequest {
  const base = trimSlash(cfg.baseUrl);
  return PROVIDERS[cfg.provider].api === 'anthropic'
    ? {
        url: `${base}/v1/models?limit=100`,
        method: 'GET',
        headers: anthropicHeaders(cfg),
      }
    : { url: `${base}/models`, method: 'GET', headers: openaiHeaders(cfg) };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Model ids from a models response (`{ data: [{ id }] }` everywhere). */
export function parseModels(provider: ProviderId, json: unknown): string[] {
  if (!isRecord(json) || !Array.isArray(json.data)) return [];
  return json.data
    .map((m) => (isRecord(m) && typeof m.id === 'string' ? m.id : ''))
    .filter(Boolean)
    .map((id) => (provider === 'gemini' ? id.replace(/^models\//, '') : id));
}

/**
 * Why a base URL can't be used, or null. The cloud providers are fixed
 * (the CSP names their hosts); a local server must be on this machine.
 */
export function baseUrlProblem(
  provider: ProviderId,
  url: string
): string | null {
  if (provider !== 'local')
    return url === PROVIDERS[provider].baseUrl
      ? null
      : `${PROVIDERS[provider].name} is reached at ${PROVIDERS[provider].baseUrl}.`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'Enter a full address, such as http://localhost:8080/v1.';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return 'Use an http:// or https:// address.';
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1')
    return 'A local server must be on this computer (localhost or 127.0.0.1).';
  return null;
}

/** What one streamed event means: some text, the end, or an error. */
export interface StreamEvent {
  text?: string;
  done?: boolean;
  error?: string;
}

const errorText = (v: unknown): string | null =>
  isRecord(v) && isRecord(v.error) && typeof v.error.message === 'string'
    ? v.error.message
    : null;

/** Read one SSE `data:` payload. */
export function streamEvent(provider: ProviderId, data: string): StreamEvent {
  if (data === '[DONE]') return { done: true };
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return {};
  }
  if (!isRecord(json)) return {};
  const error = errorText(json);
  if (error) return { error };
  if (PROVIDERS[provider].api === 'anthropic') {
    const delta = isRecord(json.delta) ? json.delta : {};
    if (json.type === 'content_block_delta' && delta.type === 'text_delta')
      return { text: String(delta.text ?? '') };
    if (json.type === 'message_delta' && delta.stop_reason === 'refusal')
      return { error: 'The model declined to answer this.' };
    if (json.type === 'message_delta' && delta.stop_reason === 'max_tokens')
      return { text: '\n\n[The reply reached its length limit.]' };
    if (json.type === 'message_stop') return { done: true };
    return {};
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
  const content =
    isRecord(choice) && isRecord(choice.delta)
      ? choice.delta.content
      : undefined;
  return typeof content === 'string' && content ? { text: content } : {};
}

const STATUS_HINT: Record<number, string> = {
  401: 'Check the API key in Assistant setup.',
  403: 'Check the API key in Assistant setup.',
};

/** A readable message for a failed HTTP response. */
export function errorMessage(status: number, body: string): string {
  let detail: string | null = null;
  try {
    const json: unknown = JSON.parse(body);
    detail = errorText(Array.isArray(json) ? json[0] : json);
  } catch {
    // Not JSON: say what the status means.
  }
  detail ??=
    status === 429
      ? 'too many requests; try again shortly'
      : status >= 500
        ? 'the server failed'
        : null;
  const hint = STATUS_HINT[status];
  return `HTTP ${status}${detail ? `: ${detail.replace(/\.$/, '')}.` : '.'}${hint ? ` ${hint}` : ''}`;
}
