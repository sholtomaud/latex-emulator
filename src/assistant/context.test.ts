import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_PROMPT,
  parseAssistantSettings,
  systemPrompt,
} from './context.ts';

describe('assistant context', () => {
  test('without permission the model gets only the instructions, never the document', () => {
    assert.equal(systemPrompt(null), SYSTEM_PROMPT);
    assert.match(SYSTEM_PROMPT, /LaTeX/);
    assert.match(SYSTEM_PROMPT, /pdflatex/);
  });

  test('with permission the document follows the fixed instructions, so they stay cached', () => {
    const s = systemPrompt({ name: 'Thesis', source: '\\section{A}' });
    assert.ok(s.startsWith(SYSTEM_PROMPT));
    assert.match(s, /<document name="Thesis">\n\\section\{A\}\n<\/document>$/);
  });

  test('a document name can’t break out of its attribute', () => {
    assert.match(
      systemPrompt({ name: 'a"b<c>', source: '' }),
      /<document name="a&quot;b&lt;c&gt;">/
    );
  });

  test('settings are read back with safe defaults', () => {
    assert.deepEqual(parseAssistantSettings(null), {
      provider: 'anthropic',
      models: {},
      localBaseUrl: 'http://localhost:8080/v1',
      readDocuments: [],
    });
    assert.deepEqual(
      parseAssistantSettings(
        JSON.stringify({
          provider: 'local',
          models: { local: 'qwen', gemini: 3 },
          localBaseUrl: 'http://127.0.0.1:9000/v1',
          readDocuments: ['d1', 2],
        })
      ),
      {
        provider: 'local',
        models: { local: 'qwen' },
        localBaseUrl: 'http://127.0.0.1:9000/v1',
        readDocuments: ['d1'],
      }
    );
    // An unknown provider or a non-local server URL falls back.
    assert.deepEqual(
      parseAssistantSettings(
        '{"provider":"evil","localBaseUrl":"https://evil.example/v1","models":[]}'
      ),
      {
        provider: 'anthropic',
        models: {},
        localBaseUrl: 'http://localhost:8080/v1',
        readDocuments: [],
      }
    );
    assert.equal(parseAssistantSettings('nope').provider, 'anthropic');
  });
});
