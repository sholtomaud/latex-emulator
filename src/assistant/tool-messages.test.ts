import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, buildChatRequest } from './providers.ts';
import type { ChatMessage, ProviderConfig, ToolDef } from './providers.ts';

const claude: ProviderConfig = {
  provider: 'anthropic',
  baseUrl: PROVIDERS.anthropic.baseUrl,
  model: 'claude-opus-5-5',
  apiKey: 'k',
};
const local: ProviderConfig = {
  provider: 'local',
  baseUrl: 'http://localhost:8080/v1',
  model: '',
};
const tools: ToolDef[] = [
  {
    name: 'zettel_create',
    description: 'Create a zettel.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
];
const THINKING = { type: 'thinking', thinking: '', signature: 'sig' };
const conversation: ChatMessage[] = [
  { role: 'user', content: 'Make a zettel.' },
  {
    role: 'assistant',
    content: 'Creating it.',
    toolCalls: [{ id: 'call_1', name: 'zettel_create', input: { title: 'T' } }],
    blocks: [
      THINKING,
      { type: 'text', text: 'Creating it.' },
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'zettel_create',
        input: { title: 'T' },
      },
    ],
  },
  {
    role: 'tool',
    callId: 'call_1',
    name: 'zettel_create',
    content: '{"id":"1"}',
  },
  { role: 'assistant', content: 'Done: 1.' },
];

describe('tools in requests (ADR 0025)', () => {
  test('Claude: tools with input_schema; the assistant’s own blocks sent back unchanged; results in a user turn', () => {
    const body = JSON.parse(
      buildChatRequest(claude, 'sys', conversation, tools).body!
    );
    assert.deepEqual(body.tools, [
      {
        name: 'zettel_create',
        description: 'Create a zettel.',
        input_schema: tools[0].parameters,
      },
    ]);
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'Make a zettel.' },
      {
        role: 'assistant',
        content:
          conversation[1].role === 'assistant' ? conversation[1].blocks : [],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: '{"id":"1"}' },
        ],
      },
      { role: 'assistant', content: 'Done: 1.' },
    ]);
  });

  test('Claude without stored blocks: text and tool_use blocks are made from the call; errors are flagged', () => {
    const body = JSON.parse(
      buildChatRequest(
        claude,
        's',
        [
          { role: 'user', content: 'x' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'a', name: 'zettel_create', input: { title: 'T' } },
            ],
          },
          {
            role: 'tool',
            callId: 'a',
            name: 'zettel_create',
            content: 'No zettel 9.',
            isError: true,
          },
        ],
        tools
      ).body!
    );
    assert.deepEqual(body.messages[1].content, [
      {
        type: 'tool_use',
        id: 'a',
        name: 'zettel_create',
        input: { title: 'T' },
      },
    ]);
    assert.deepEqual(body.messages[2].content, [
      {
        type: 'tool_result',
        tool_use_id: 'a',
        content: 'No zettel 9.',
        is_error: true,
      },
    ]);
  });

  test('OpenAI-compatible: function tools, tool_calls with JSON arguments, tool messages', () => {
    const body = JSON.parse(
      buildChatRequest(local, 'sys', conversation, tools).body!
    );
    assert.deepEqual(body.tools, [
      {
        type: 'function',
        function: {
          name: 'zettel_create',
          description: 'Create a zettel.',
          parameters: tools[0].parameters,
        },
      },
    ]);
    assert.deepEqual(body.messages.slice(1), [
      { role: 'user', content: 'Make a zettel.' },
      {
        role: 'assistant',
        content: 'Creating it.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'zettel_create', arguments: '{"title":"T"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"id":"1"}' },
      { role: 'assistant', content: 'Done: 1.' },
    ]);
  });

  test('no tools: no tools field; an empty assistant turn is not sent', () => {
    const body = JSON.parse(
      buildChatRequest(local, 's', [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'b' },
      ]).body!
    );
    assert.equal(body.tools, undefined);
    assert.deepEqual(
      body.messages.map((m: { role: string }) => m.role),
      ['system', 'user', 'user']
    );
  });
});
