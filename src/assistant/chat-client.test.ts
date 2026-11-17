import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchModels, streamChat, streamReply } from './chat-client.ts';
import type { HttpRequest } from './providers.ts';

const req: HttpRequest = {
  url: 'http://localhost:8080/v1/chat/completions',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
};

/** A fetch that answers with these body chunks (or this status). */
function fakeFetch(chunks: string[], status = 200, seen: HttpRequest[] = []) {
  return async (url: string, init: RequestInit) => {
    seen.push({
      url,
      method: init.method as 'POST',
      headers: init.headers as Record<string, string>,
      body: init.body as string,
    });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(enc.encode(chunk));
        c.close();
      },
    });
    return new Response(body, { status });
  };
}

async function collect(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const t of gen) out.push(t);
  return out;
}

describe('streamChat', () => {
  test('yields text deltas as they arrive and stops at the end event', async () => {
    const seen: HttpRequest[] = [];
    const parts = await collect(
      streamChat('local', req, {
        fetch: fakeFetch(
          [
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
            'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
          ],
          200,
          seen
        ),
      })
    );
    assert.deepEqual(parts, ['Hel', 'lo']);
    assert.equal(seen[0].url, req.url);
    assert.equal(seen[0].body, '{}');
  });

  test('a stream that ends without an end event still returns what came', async () => {
    const parts = await collect(
      streamChat('anthropic', req, {
        fetch: fakeFetch([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A"}}',
        ]),
      })
    );
    assert.deepEqual(parts, ['A']);
  });

  test('an error event or an HTTP error throws with the provider’s message', async () => {
    await assert.rejects(
      collect(
        streamChat('anthropic', req, {
          fetch: fakeFetch([
            'data: {"type":"error","error":{"message":"Overloaded"}}\n\n',
          ]),
        })
      ),
      /Overloaded/
    );
    await assert.rejects(
      collect(
        streamChat('openrouter', req, {
          fetch: fakeFetch(['{"error":{"message":"No credits"}}'], 402),
        })
      ),
      /HTTP 402: No credits/
    );
  });

  test('a server that can’t be reached says where it looked', async () => {
    await assert.rejects(
      collect(
        streamChat('local', req, {
          fetch: async () => {
            throw new TypeError('Failed to fetch');
          },
        })
      ),
      /Couldn’t reach http:\/\/localhost:8080/
    );
  });
});

describe('fetchModels', () => {
  test('reads the ids, or explains an HTTP error', async () => {
    const get = { ...req, method: 'GET' as const, body: undefined };
    assert.deepEqual(
      await fetchModels('local', get, {
        fetch: fakeFetch(['{"data":[{"id":"qwen3-4b"}]}']),
      }),
      ['qwen3-4b']
    );
    await assert.rejects(
      fetchModels('local', get, { fetch: fakeFetch(['nope'], 503) }),
      /HTTP 503/
    );
  });
});

describe('streamReply', () => {
  test('streams the text, then returns the reply with its tool calls', async () => {
    const shown: string[] = [];
    const reply = await streamReply(
      'local',
      req,
      {
        fetch: fakeFetch([
          'data: {"choices":[{"delta":{"content":"Look"}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"comments_list","arguments":"{}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      },
      (t) => shown.push(t)
    );
    assert.deepEqual(shown, ['Look']);
    assert.deepEqual(reply, {
      text: 'Look',
      toolCalls: [{ id: 'c', name: 'comments_list', input: {} }],
    });
  });

  test('an error event throws', async () => {
    await assert.rejects(
      streamReply(
        'anthropic',
        req,
        {
          fetch: fakeFetch([
            'data: {"type":"error","error":{"message":"Overloaded"}}\n\n',
          ]),
        },
        () => {}
      ),
      /Overloaded/
    );
  });
});
