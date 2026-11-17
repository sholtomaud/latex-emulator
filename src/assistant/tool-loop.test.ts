import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantController, MemoryChats } from './assistant-controller.ts';
import { KeyStore } from './key-store.ts';
import type { ToolCall } from './providers.ts';
import { TOOL_GUIDE } from './context.ts';

type Turn =
  | { text?: string; calls?: { name: string; args: string }[] }
  | { status: number; body: string }
  | 'wait';

/** A local server answering each request with the next turn (OpenAI shape). */
function server(turns: Turn[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    const turn = turns.shift() ?? { text: 'ok' };
    if (turn === 'wait')
      return new Promise<Response>((_r, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        )
      );
    if ('status' in turn) return new Response(turn.body, turn);
    const events: string[] = [];
    if (turn.text)
      events.push(
        JSON.stringify({ choices: [{ delta: { content: turn.text } }] })
      );
    turn.calls?.forEach((c, i) =>
      events.push(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: `call_${bodies.length}_${i}`,
                    function: { name: c.name, arguments: c.args },
                  },
                ],
              },
            },
          ],
        })
      )
    );
    events.push('[DONE]');
    return new Response(events.map((e) => `data: ${e}\n\n`).join(''), {
      status: 200,
    });
  };
  return { fetch, bodies };
}

function make(
  turns: Turn[],
  run?: (c: ToolCall) => Promise<{ content: string; isError?: true }>
) {
  const s = server(turns);
  const ran: ToolCall[] = [];
  const c = new AssistantController({
    fetch: s.fetch,
    chats: new MemoryChats(),
    keys: new KeyStore(null),
    readPref: () => null,
    writePref: () => {},
    tools: {
      definitions: () => [
        {
          name: 'comments_list',
          description: 'List.',
          parameters: { type: 'object', properties: {} },
        },
      ],
      run: async (call) => {
        ran.push(call);
        return run ? run(call) : { content: '{"threads":[]}' };
      },
    },
  });
  c.setProvider('local');
  return { c, bodies: s.bodies, ran };
}

describe('the tool loop (ADR 0025)', () => {
  test('a call is run, its result sent back, and the answer streams in', async () => {
    const { c, bodies, ran } = make([
      { text: 'Checking.', calls: [{ name: 'comments_list', args: '{}' }] },
      { text: 'There are no comments.' },
    ]);
    await c.openDocument('d1', 'Doc');
    await c.send('Any comments?', '');
    assert.deepEqual(
      ran.map((r) => r.name),
      ['comments_list']
    );
    assert.equal(bodies.length, 2);
    assert.ok(Array.isArray(bodies[0].tools));
    // The system prompt tells the model about its tools.
    assert.match(
      (bodies[0].messages as { content: string }[])[0].content,
      new RegExp(TOOL_GUIDE.slice(0, 30))
    );
    const second = bodies[1].messages as {
      role: string;
      content: string;
      tool_call_id?: string;
    }[];
    assert.deepEqual(
      second.slice(-2).map((m) => m.role),
      ['assistant', 'tool']
    );
    assert.equal(second.at(-1)!.content, '{"threads":[]}');
    const shown = c.store.getState().messages;
    assert.deepEqual(
      shown.map((m) => m.role),
      ['user', 'assistant', 'tool', 'assistant']
    );
    assert.equal(shown.at(-1)!.content, 'There are no comments.');
    assert.equal(c.store.getState().streaming, false);
  });

  test('tools turned off for a provider: no tools sent, no guide', async () => {
    const { c, bodies } = make([{ text: 'Hi.' }]);
    c.setToolsEnabled('local', false);
    assert.equal(c.toolsEnabled('local'), false);
    await c.openDocument('d1', 'Doc');
    await c.send('Hello', '');
    assert.equal(bodies[0].tools, undefined);
    assert.doesNotMatch(
      (bodies[0].messages as { content: string }[])[0].content,
      /tools/i
    );
  });

  test('an error after tools have run keeps what was done, with every call answered', async () => {
    const { c } = make([
      { calls: [{ name: 'comments_list', args: '{}' }] },
      { status: 500, body: '{"error":{"message":"Model crashed"}}' },
    ]);
    await c.openDocument('d1', 'Doc');
    await c.send('Go', '');
    const s = c.store.getState();
    assert.match(s.error, /Model crashed/);
    assert.equal(s.draft, '');
    assert.deepEqual(
      s.messages.map((m) => m.role),
      ['user', 'assistant', 'tool']
    );
  });

  test('Stop while a reply is pending after tools: calls stay answered', async () => {
    const { c } = make([
      {
        calls: [
          { name: 'comments_list', args: '{}' },
          { name: 'comments_list', args: '{}' },
        ],
      },
      'wait',
    ]);
    await c.openDocument('d1', 'Doc');
    const sending = c.send('Go', '');
    await new Promise((r) => setTimeout(r, 30));
    c.stop();
    await sending;
    const roles = c.store.getState().messages.map((m) => m.role);
    assert.deepEqual(roles, ['user', 'assistant', 'tool', 'tool', 'assistant']);
    assert.match(c.store.getState().messages.at(-1)!.content, /Stopped/);
  });

  test('Stop during a tool run: the rest are answered "stopped", not run', async () => {
    let release: () => void = () => {};
    const { c, ran } = make(
      [
        {
          calls: [
            { name: 'comments_list', args: '{}' },
            { name: 'comments_list', args: '{}' },
          ],
        },
      ],
      () =>
        new Promise((resolve) => (release = () => resolve({ content: 'late' })))
    );
    await c.openDocument('d1', 'Doc');
    const sending = c.send('Go', '');
    await new Promise((r) => setTimeout(r, 30));
    c.stop();
    release();
    await sending;
    assert.equal(ran.length, 1);
    const tools = c.store.getState().messages.filter((m) => m.role === 'tool');
    assert.equal(tools.length, 2);
    assert.match(tools[1].content, /Stopped before running/);
  });

  test('the loop ends after 10 rounds of tool calls', async () => {
    const turns: Turn[] = Array.from({ length: 12 }, () => ({
      calls: [{ name: 'comments_list', args: '{}' }],
    }));
    const { c, ran } = make(turns);
    await c.openDocument('d1', 'Doc');
    await c.send('Loop', '');
    assert.equal(ran.length, 10);
    assert.match(c.store.getState().messages.at(-1)!.content, /10 rounds/);
  });

  test('llama.cpp without --jinja: the error says how to fix it', async () => {
    const { c } = make([
      {
        status: 500,
        body: '{"error":{"message":"tools param requires --jinja flag"}}',
      },
    ]);
    await c.openDocument('d1', 'Doc');
    await c.send('Go', '');
    assert.match(c.store.getState().error, /--jinja.*turn tools off/s);
  });
});
