import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantController, MemoryChats } from './assistant-controller.ts';
import { KeyStore } from './key-store.ts';
import { SYSTEM_PROMPT } from './context.ts';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** A fetch that streams these OpenAI-style deltas, and records requests. */
function server(
  replies: (string[] | { status: number; body: string })[] = [],
  sent: Sent[] = []
) {
  const fetch = async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : null,
    });
    const reply = replies.shift() ?? ['ok'];
    if (!Array.isArray(reply)) return new Response(reply.body, reply);
    if (url.endsWith('/models'))
      return new Response(
        JSON.stringify({ data: reply.map((id) => ({ id })) }),
        { status: 200 }
      );
    const signal = init.signal;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        const next = reply.shift();
        if (next === undefined) {
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
          return;
        }
        if (next === '<wait>') {
          await new Promise<void>((resolve) =>
            signal?.addEventListener('abort', () => resolve())
          );
          c.error(new DOMException('Aborted', 'AbortError'));
          return;
        }
        c.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: next } }] })}\n\n`
          )
        );
      },
    });
    return new Response(body, { status: 200 });
  };
  return { fetch, sent };
}

function make(
  replies?: Parameters<typeof server>[0],
  prefs = new Map<string, string>()
) {
  const s = server(replies);
  const chats = new MemoryChats();
  const keys = new KeyStore(null);
  const c = new AssistantController({
    fetch: s.fetch,
    chats,
    keys,
    readPref: (k) => prefs.get(k) ?? null,
    writePref: (k, v) => void prefs.set(k, v),
  });
  return { c, sent: s.sent, chats, keys, prefs };
}

const localSetup = (c: AssistantController) => c.setProvider('local');

describe('AssistantController', () => {
  test('sending streams the reply into the conversation and saves it with the document', async () => {
    const { c, sent, chats } = make([['Use ', '\\emph.']]);
    localSetup(c);
    await c.openDocument('d1', 'Thesis');
    const states: string[] = [];
    c.store.addEventListener('change', () =>
      states.push(c.store.getState().messages.at(-1)?.content ?? '')
    );
    await c.send('How do I italicise?', 'source');
    const s = c.store.getState();
    assert.deepEqual(s.messages, [
      { role: 'user', content: 'How do I italicise?' },
      { role: 'assistant', content: 'Use \\emph.' },
    ]);
    assert.equal(s.streaming, false);
    assert.equal(s.error, '');
    // The reply grew piece by piece.
    assert.ok(states.includes('Use '));
    // Not allowed to read the document: only the instructions are sent.
    assert.equal(sent[0].url, 'http://localhost:8080/v1/chat/completions');
    const messages = sent[0].body!.messages as { content: string }[];
    assert.equal(messages[0].content, SYSTEM_PROMPT);
    assert.deepEqual(await chats.get('d1'), s.messages);
  });

  test('a document the assistant may read is sent with the instructions', async () => {
    const { c, sent, prefs } = make([['A'], ['B']]);
    localSetup(c);
    await c.openDocument('d1', 'Thesis');
    c.allowReading(true);
    assert.equal(c.store.getState().mayRead, true);
    await c.send('Q', '\\section{X}');
    assert.match(
      (sent[0].body!.messages as { content: string }[])[0].content,
      /<document name="Thesis">\n\\section\{X\}/
    );
    // Remembered per document.
    assert.deepEqual(
      JSON.parse(prefs.get('assistant-settings')!).readDocuments,
      ['d1']
    );
    await c.openDocument('d2', 'Other');
    assert.equal(c.store.getState().mayRead, false);
    await c.send('Q', 'secret');
    assert.doesNotMatch(
      (sent[1].body!.messages as { content: string }[])[0].content,
      /secret/
    );
    await c.openDocument('d1', 'Thesis');
    c.allowReading(false);
    assert.deepEqual(
      JSON.parse(prefs.get('assistant-settings')!).readDocuments,
      []
    );
  });

  test('each document keeps its own conversation', async () => {
    const { c } = make([['one'], ['two']]);
    localSetup(c);
    await c.openDocument('d1', 'A');
    await c.send('first', '');
    await c.openDocument('d2', 'B');
    assert.deepEqual(c.store.getState().messages, []);
    await c.send('second', '');
    await c.openDocument('d1', 'A');
    assert.equal(c.store.getState().messages[1].content, 'one');
    await c.clear();
    assert.deepEqual(c.store.getState().messages, []);
    await c.openDocument('d1', 'A');
    assert.deepEqual(c.store.getState().messages, []);
  });

  test('a provider that needs a key says so instead of sending', async () => {
    const { c, sent, keys } = make([['hi']]);
    await c.openDocument('d1', 'A');
    await c.send('Q', '');
    assert.match(
      c.store.getState().error,
      /Claude \(Anthropic\) needs an API key/
    );
    assert.equal(sent.length, 0);
    // The question is kept, so it can be sent again.
    assert.deepEqual(c.store.getState().messages, []);
    assert.equal(c.store.getState().draft, 'Q');
    await keys.set('anthropic', 'sk', false);
    assert.equal(c.store.getState().error, '');
  });

  test('errors are shown and the unanswered question is kept for a retry', async () => {
    const { c } = make([
      { status: 401, body: '{"error":{"message":"bad key"}}' },
    ]);
    localSetup(c);
    await c.openDocument('d1', 'A');
    await c.send('Q', '');
    const s = c.store.getState();
    assert.match(s.error, /HTTP 401: bad key/);
    assert.deepEqual(s.messages, []);
    assert.equal(s.draft, 'Q');
    assert.equal(s.streaming, false);
  });

  test('Stop keeps what has arrived', async () => {
    const { c } = make([['part', '<wait>']]);
    localSetup(c);
    await c.openDocument('d1', 'A');
    const sending = c.send('Q', '');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.store.getState().streaming, true);
    c.stop();
    await sending;
    const s = c.store.getState();
    assert.equal(s.streaming, false);
    assert.equal(s.error, '');
    assert.deepEqual(s.messages.at(-1), {
      role: 'assistant',
      content: 'part\n\n[Stopped.]',
    });
  });

  test('blank messages and a second send while streaming are ignored', async () => {
    const { c, sent } = make([['x', '<wait>']]);
    localSetup(c);
    await c.openDocument('d1', 'A');
    await c.send('   ', '');
    assert.equal(sent.length, 0);
    const first = c.send('Q', '');
    await new Promise((r) => setTimeout(r, 10));
    await c.send('Again', '');
    assert.equal(sent.length, 1);
    c.stop();
    await first;
  });

  test('provider, model and local server address are remembered', () => {
    const prefs = new Map<string, string>();
    const { c } = make([], prefs);
    c.setProvider('gemini');
    c.setModel('gemini', 'gemini-x');
    assert.equal(c.setLocalBaseUrl('http://127.0.0.1:9000/v1'), null);
    assert.match(c.setLocalBaseUrl('https://evil.example')!, /this computer/);
    const again = make([], prefs).c;
    const s = again.store.getState().settings;
    assert.equal(s.provider, 'gemini');
    assert.equal(s.models.gemini, 'gemini-x');
    assert.equal(s.localBaseUrl, 'http://127.0.0.1:9000/v1');
    assert.equal(again.config('gemini').model, 'gemini-x');
    // No model chosen: the provider's default.
    assert.equal(again.config('anthropic').model, 'claude-opus-5-5');
    assert.equal(again.config('local').baseUrl, 'http://127.0.0.1:9000/v1');
  });

  test('loading models and testing a connection report what happened', async () => {
    const { c, sent } = make([
      ['qwen3-4b', 'gemma'],
      { status: 503, body: '' },
      ['hello'],
    ]);
    assert.deepEqual(await c.loadModels('local'), ['qwen3-4b', 'gemma']);
    assert.equal(sent[0].url, 'http://localhost:8080/v1/models');
    await assert.rejects(c.loadModels('local'), /HTTP 503/);
    assert.equal(
      await c.testConnection('local'),
      'Connected: the model replied “hello”.'
    );
    assert.match(await c.testConnection('anthropic'), /needs an API key/);
  });

  test('a selection attached to a question is sent with it, once, even without access to the document', async () => {
    const { c, sent } = make([['A'], ['B']]);
    localSetup(c);
    await c.openDocument('d1', 'A');
    let focus = 0;
    c.store.addEventListener('focus-composer', () => focus++);
    const ex = { text: '\\section{X}', startLine: 3, endLine: 3 };
    c.attach(ex, { focus: true });
    assert.deepEqual(c.store.getState().attachment, ex);
    assert.equal(focus, 1);
    await c.send('Better title?', 'whole source');
    const messages = sent[0].body!.messages as { content: string }[];
    assert.match(messages.at(-1)!.content, /^About line 3 of my document:/);
    assert.match(messages.at(-1)!.content, /Better title\?$/);
    // The document itself is still not sent.
    assert.doesNotMatch(messages[0].content, /whole source/);
    // Shown in the conversation as sent; the attachment is used up.
    assert.match(c.store.getState().messages[0].content, /\\section\{X\}/);
    assert.equal(c.store.getState().attachment, null);
    await c.send('Next', '');
    assert.equal(
      (sent[1].body!.messages as { content: string }[]).at(-1)!.content,
      'Next'
    );
  });

  test('a failed send keeps the attachment; removing it or switching document drops it', async () => {
    const { c } = make([{ status: 500, body: '' }]);
    localSetup(c);
    await c.openDocument('d1', 'A');
    const ex = { text: 'x', startLine: 1, endLine: 1 };
    c.attach(ex);
    await c.send('Q', '');
    assert.deepEqual(c.store.getState().attachment, ex);
    assert.equal(c.store.getState().draft, 'Q');
    c.attach(null);
    assert.equal(c.store.getState().attachment, null);
    c.attach(ex);
    await c.openDocument('d2', 'B');
    assert.equal(c.store.getState().attachment, null);
    // An empty selection attaches nothing.
    c.attach({ text: '  ', startLine: 1, endLine: 1 });
    assert.equal(c.store.getState().attachment, null);
  });
});
