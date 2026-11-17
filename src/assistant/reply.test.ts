import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplyAssembler } from './reply.ts';

const feedAll = (r: ReplyAssembler, events: unknown[]) =>
  events.map((e) => r.feed(typeof e === 'string' ? e : JSON.stringify(e)));

describe('ReplyAssembler: Claude', () => {
  test('text, thinking (with its signature) and a tool call become blocks to send back', () => {
    const r = new ReplyAssembler('anthropic');
    const out = feedAll(r, [
      { type: 'message_start', message: {} },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'hmm' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'SIG' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Making ' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'it.' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'zettel_create',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"title":' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '"T"}' },
      },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ]);
    // Only text reaches the screen while streaming.
    assert.deepEqual(
      out.filter((o) => o.text).map((o) => o.text),
      ['Making ', 'it.']
    );
    assert.ok(out.at(-1)!.done);
    assert.deepEqual(r.result(), {
      text: 'Making it.',
      toolCalls: [
        { id: 'toolu_1', name: 'zettel_create', input: { title: 'T' } },
      ],
      blocks: [
        { type: 'thinking', thinking: 'hmm', signature: 'SIG' },
        { type: 'text', text: 'Making it.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'zettel_create',
          input: { title: 'T' },
        },
      ],
    });
  });

  test('a redacted thinking block is kept as it came; a tool call with no input gets {}', () => {
    const r = new ReplyAssembler('anthropic');
    feedAll(r, [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'redacted_thinking', data: 'X' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 't',
          name: 'comments_list',
          input: {},
        },
      },
      { type: 'content_block_stop', index: 1 },
    ]);
    assert.deepEqual(r.result().blocks, [
      { type: 'redacted_thinking', data: 'X' },
      { type: 'tool_use', id: 't', name: 'comments_list', input: {} },
    ]);
    assert.deepEqual(r.result().toolCalls[0].input, {});
  });

  test('errors, refusals and the length limit are reported as before', () => {
    const r = new ReplyAssembler('anthropic');
    assert.deepEqual(
      r.feed('{"type":"error","error":{"message":"Overloaded"}}'),
      {
        error: 'Overloaded',
      }
    );
    assert.deepEqual(
      r.feed('{"type":"message_delta","delta":{"stop_reason":"refusal"}}'),
      { error: 'The model declined to answer this.' }
    );
    const t = new ReplyAssembler('anthropic');
    const note = t.feed(
      '{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}'
    );
    assert.match(note.text!, /length limit/);
    assert.match(t.result().text, /length limit/);
    assert.deepEqual(t.feed('not json'), {});
  });
});

describe('ReplyAssembler: OpenAI-compatible', () => {
  test('text, then tool calls whose arguments arrive in pieces', () => {
    const r = new ReplyAssembler('openai');
    const out = feedAll(r, [
      { choices: [{ delta: { role: 'assistant', content: 'Checking.' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'c1',
                  type: 'function',
                  function: { name: 'zettel_search', arguments: '' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"query":' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"energy"}' } },
                {
                  index: 1,
                  id: 'c2',
                  function: { name: 'comments_list', arguments: '{}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ]);
    assert.deepEqual(
      out.filter((o) => o.text).map((o) => o.text),
      ['Checking.']
    );
    assert.ok(out.at(-1)!.done);
    assert.deepEqual(r.result(), {
      text: 'Checking.',
      toolCalls: [
        { id: 'c1', name: 'zettel_search', input: { query: 'energy' } },
        { id: 'c2', name: 'comments_list', input: {} },
      ],
    });
  });

  test('arguments that are not a JSON object become a call the tool will reject', () => {
    const r = new ReplyAssembler('openai');
    feedAll(r, [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'x',
                  function: { name: 'zettel_get', arguments: '{"id":' },
                },
              ],
            },
          },
        ],
      },
    ]);
    assert.deepEqual(r.result().toolCalls, [
      { id: 'x', name: 'zettel_get', input: { _invalidArguments: '{"id":' } },
    ]);
  });

  test('a local server that leaves out call ids still gets unique ones', () => {
    const r = new ReplyAssembler('openai');
    feedAll(r, [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { name: 'a', arguments: '{}' } },
                { index: 1, function: { name: 'b', arguments: '{}' } },
              ],
            },
          },
        ],
      },
    ]);
    const ids = r.result().toolCalls.map((c) => c.id);
    assert.equal(new Set(ids).size, 2);
  });
});
