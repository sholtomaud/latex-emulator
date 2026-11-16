/**
 * Sends a provider request and streams the reply's text. The fetch is
 * passed in, so this runs (and is tested) without a browser.
 */
import { SseParser } from './sse.ts';
import { errorMessage, parseModels, streamEvent } from './providers.ts';
import type { HttpRequest, ProviderId } from './providers.ts';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetch: Fetch;
  signal?: AbortSignal;
}

async function send(req: HttpRequest, { fetch, signal }: ClientOptions) {
  let res: Response;
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    const origin = new URL(req.url).origin;
    throw new Error(
      `Couldn’t reach ${origin}. Is the server running, and does it allow requests from this page (CORS)?`,
      { cause: e }
    );
  }
  if (!res.ok) throw new Error(errorMessage(res.status, await res.text()));
  return res;
}

/** The reply's text, piece by piece, until the provider says it is done. */
export async function* streamChat(
  provider: ProviderId,
  req: HttpRequest,
  options: ClientOptions
): AsyncGenerator<string> {
  const res = await send(req, options);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const sse = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const payloads = done ? sse.flush() : sse.push(value);
      for (const data of payloads) {
        const event = streamEvent(provider, data);
        if (event.error) throw new Error(event.error);
        if (event.text) yield event.text;
        if (event.done) return;
      }
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** The model ids the provider offers. */
export async function fetchModels(
  provider: ProviderId,
  req: HttpRequest,
  options: ClientOptions
): Promise<string[]> {
  const res = await send(req, options);
  return parseModels(provider, await res.json().catch(() => null));
}
