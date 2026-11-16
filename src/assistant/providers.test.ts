import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_IDS,
  PROVIDERS,
  baseUrlProblem,
  buildChatRequest,
  buildModelsRequest,
  errorMessage,
  parseModels,
  streamEvent,
} from './providers.ts';
import type { ProviderConfig } from './providers.ts';

const claude: ProviderConfig = {
  provider: 'anthropic',
  baseUrl: PROVIDERS.anthropic.baseUrl,
  model: 'claude-opus-5-5',
  apiKey: 'sk-ant-test',
};
const local: ProviderConfig = {
  provider: 'local',
  baseUrl: 'http://localhost:8080/v1',
  model: '',
};
const history = [
  { role: 'user' as const, content: 'Hi' },
  { role: 'assistant' as const, content: 'Hello.' },
  { role: 'user' as const, content: 'Fix my \\section.' },
];

describe('providers (ADR 0023)', () => {
  test('Claude, OpenRouter, Gemini and a local server, Claude first', () => {
    assert.deepEqual(PROVIDER_IDS, [
      'anthropic',
      'openrouter',
      'gemini',
      'local',
    ]);
    assert.equal(PROVIDERS.anthropic.defaultModel, 'claude-opus-5-5');
    assert.equal(PROVIDERS.local.needsKey, false);
    for (const id of ['anthropic', 'openrouter', 'gemini'] as const)
      assert.equal(PROVIDERS[id].needsKey, true);
  });

  test('Claude: the Messages API, streamed, with the browser-access header', () => {
    const req = buildChatRequest(claude, 'You help with LaTeX.', history);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(req.headers['x-api-key'], 'sk-ant-test');
    assert.equal(req.headers['anthropic-version'], '2026-10-21');
    assert.equal(
      req.headers['anthropic-dangerous-direct-browser-access'],
      'true'
    );
    // A refused reply is re-run on another model by the API itself.
    assert.equal(
      req.headers['anthropic-beta'],
      'server-side-fallback-2026-07-01'
    );
    const body = JSON.parse(req.body!);
    assert.equal(body.model, 'claude-opus-5-5');
    assert.equal(body.stream, true);
    assert.equal(body.system, 'You help with LaTeX.');
    assert.equal(body.fallbacks, 'default');
    assert.ok(body.max_tokens >= 16000);
    assert.deepEqual(body.messages, history);
  });

  test('Claude: an older model gets no fallbacks', () => {
    const req = buildChatRequest(
      { ...claude, model: 'claude-haiku-4-5' },
      's',
      history
    );
    assert.equal(req.headers['anthropic-beta'], undefined);
    assert.equal(JSON.parse(req.body!).fallbacks, undefined);
  });

  test('OpenAI-compatible: chat/completions, the system prompt first, a bearer key', () => {
    const req = buildChatRequest(
      {
        provider: 'openrouter',
        baseUrl: PROVIDERS.openrouter.baseUrl,
        model: 'openrouter/auto',
        apiKey: 'or-key',
      },
      'sys',
      history
    );
    assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer or-key');
    const body = JSON.parse(req.body!);
    assert.equal(body.stream, true);
    assert.equal(body.model, 'openrouter/auto');
    assert.deepEqual(body.messages[0], { role: 'system', content: 'sys' });
    assert.equal(body.messages.length, 4);
    assert.equal(body.cache_prompt, undefined);
  });

  test('a local server: no key, no model needed, and llama.cpp keeps the prompt cached', () => {
    const req = buildChatRequest(local, 'sys', history);
    assert.equal(req.url, 'http://localhost:8080/v1/chat/completions');
    assert.equal(req.headers.authorization, undefined);
    const body = JSON.parse(req.body!);
    assert.equal(body.model, undefined);
    assert.equal(body.cache_prompt, true);
  });

  test('a trailing slash in a base URL is ignored', () => {
    assert.equal(
      buildChatRequest(
        { ...local, baseUrl: 'http://127.0.0.1:8081/v1/' },
        's',
        []
      ).url,
      'http://127.0.0.1:8081/v1/chat/completions'
    );
  });

  test('model lists: each provider’s endpoint, ids read back', () => {
    const a = buildModelsRequest(claude);
    assert.equal(a.method, 'GET');
    assert.equal(a.url, 'https://api.anthropic.com/v1/models?limit=100');
    assert.equal(a.headers['x-api-key'], 'sk-ant-test');
    assert.deepEqual(
      parseModels('anthropic', {
        data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }],
      }),
      ['claude-opus-5-5', 'claude-haiku-5-5']
    );
    const g = buildModelsRequest({
      provider: 'gemini',
      baseUrl: PROVIDERS.gemini.baseUrl,
      model: '',
      apiKey: 'g',
    });
    assert.equal(
      g.url,
      'https://generativelanguage.googleapis.com/v1beta/openai/models'
    );
    assert.equal(g.headers.authorization, 'Bearer g');
    // Gemini's ids carry a "models/" prefix its chat endpoint doesn't want.
    assert.deepEqual(
      parseModels('gemini', { data: [{ id: 'models/gemini-x' }, { id: 7 }] }),
      ['gemini-x']
    );
    assert.deepEqual(parseModels('local', null), []);
    assert.deepEqual(parseModels('local', { data: 'no' }), []);
  });

  test('only the allowed hosts: the cloud providers are fixed, a local server is on this machine', () => {
    assert.equal(
      baseUrlProblem('anthropic', PROVIDERS.anthropic.baseUrl),
      null
    );
    assert.match(
      baseUrlProblem('anthropic', 'https://evil.example')!,
      /api\.anthropic\.com/
    );
    for (const ok of [
      'http://localhost:8080/v1',
      'http://127.0.0.1:1234/v1',
      'https://localhost/v1',
    ])
      assert.equal(baseUrlProblem('local', ok), null, ok);
    for (const bad of [
      'http://192.168.1.5:8080/v1',
      'https://api.deepseek.com/v1',
      'ftp://localhost/',
      'not a url',
    ])
      assert.ok(baseUrlProblem('local', bad), bad);
  });

  test('Claude stream events: text, the end, a refusal, an error', () => {
    assert.deepEqual(
      streamEvent(
        'anthropic',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}'
      ),
      { text: 'Hel' }
    );
    assert.deepEqual(streamEvent('anthropic', '{"type":"message_stop"}'), {
      done: true,
    });
    assert.deepEqual(
      streamEvent(
        'anthropic',
        '{"type":"message_delta","delta":{"stop_reason":"refusal"}}'
      ),
      { error: 'The model declined to answer this.' }
    );
    assert.deepEqual(
      streamEvent(
        'anthropic',
        '{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}'
      ),
      { text: '\n\n[The reply reached its length limit.]' }
    );
    assert.deepEqual(
      streamEvent(
        'anthropic',
        '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'
      ),
      { error: 'Overloaded' }
    );
    // Thinking and other events carry no text.
    assert.deepEqual(
      streamEvent(
        'anthropic',
        '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"…"}}'
      ),
      {}
    );
    assert.deepEqual(streamEvent('anthropic', 'not json'), {});
  });

  test('OpenAI-compatible stream events: deltas, [DONE], errors', () => {
    assert.deepEqual(
      streamEvent('openrouter', '{"choices":[{"delta":{"content":"lo"}}]}'),
      { text: 'lo' }
    );
    assert.deepEqual(streamEvent('local', '[DONE]'), { done: true });
    assert.deepEqual(
      streamEvent('gemini', '{"error":{"message":"Quota exceeded"}}'),
      { error: 'Quota exceeded' }
    );
    assert.deepEqual(
      streamEvent('local', '{"choices":[{"delta":{"role":"assistant"}}]}'),
      {}
    );
    assert.deepEqual(streamEvent('local', '{"choices":[]}'), {});
  });

  test('HTTP errors say what went wrong, from any provider’s error shape', () => {
    assert.equal(
      errorMessage(
        401,
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'
      ),
      'HTTP 401: invalid x-api-key. Check the API key in Assistant setup.'
    );
    assert.equal(
      errorMessage(
        400,
        '[{"error":{"code":400,"message":"API key not valid."}}]'
      ),
      'HTTP 400: API key not valid.'
    );
    assert.equal(
      errorMessage(429, ''),
      'HTTP 429: too many requests; try again shortly.'
    );
    assert.equal(
      errorMessage(500, '<html>oops</html>'),
      'HTTP 500: the server failed.'
    );
    assert.equal(errorMessage(404, '{}'), 'HTTP 404.');
  });
});
