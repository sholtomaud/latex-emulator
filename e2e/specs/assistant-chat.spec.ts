import { test, expect } from '@playwright/test';
import type { Page, Request, Route } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';
import { openView } from '../support/views.ts';

/**
 * The assistant's chat (ADR 0023): providers chosen and keyed in Assistant
 * setup, replies streamed into the pane, the document sent only where the
 * author allows it. Every provider is mocked; nothing leaves the machine.
 */

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Assistant' });
const setup = (page: Page) =>
  page.getByRole('region', { name: 'Assistant setup' });
const provider = (page: Page, name: string) =>
  setup(page).getByRole('group', { name });
const input = (page: Page) => panel(page).getByLabel('Message the assistant');
const log = (page: Page) =>
  panel(page).getByRole('log', { name: 'Conversation' });

/** An OpenAI-style streamed reply. */
const openaiStream = (...pieces: string[]) =>
  pieces
    .map(
      (p) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`
    )
    .join('') + 'data: [DONE]\n\n';

/** An Anthropic Messages streamed reply. */
const claudeStream = (...pieces: string[]) =>
  [
    'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
    ...pieces.map(
      (p) =>
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })}\n\n`
    ),
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join('');

const sse = (route: Route, body: string) =>
  route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'access-control-allow-origin': '*',
    },
    body,
  });

/** Record each request to a host, and answer with `reply`. */
async function mock(
  page: Page,
  pattern: string,
  reply: (route: Route, req: Request) => Promise<void> | void
) {
  const seen: Request[] = [];
  await page.route(pattern, async (route) => {
    seen.push(route.request());
    await reply(route, route.request());
  });
  return seen;
}

async function start(page: Page) {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/');
  await editorReady(page);
}

async function chooseLocal(page: Page) {
  await openView(page, 'Assistant setup');
  await provider(page, 'Local server (llama.cpp)')
    .getByRole('radio', { name: 'Use Local server (llama.cpp)' })
    .check();
}

async function openChat(page: Page) {
  if (!(await panel(page).isVisible()))
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}

async function ask(page: Page, text: string) {
  await input(page).fill(text);
  await input(page).press('ControlOrMeta+Enter');
}

test('a local llama.cpp server: no key, the reply streams in, code gets a Copy button', async ({
  page,
}) => {
  const seen = await mock(page, 'http://localhost:8080/v1/**', (route) =>
    sse(
      route,
      openaiStream('Use ', '`\\emph`:\n```latex\n\\emph{word}\n```\nDone.')
    )
  );
  await start(page);
  await chooseLocal(page);
  await openChat(page);
  await expect(panel(page).getByLabel('Provider')).toHaveValue('local');
  await ask(page, 'How do I italicise a word?');
  const items = log(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('How do I italicise a word?');
  await expect(items.nth(1)).toContainText('Use `\\emph`:');
  await expect(items.nth(1).locator('pre code')).toHaveText('\\emph{word}');
  await expect(
    items.nth(1).getByRole('button', { name: 'Copy code' })
  ).toBeVisible();
  await expect(input(page)).toHaveValue('');

  const req = seen[0];
  expect(req.url()).toBe('http://localhost:8080/v1/chat/completions');
  expect(req.headers().authorization).toBeUndefined();
  const body = req.postDataJSON();
  expect(body.stream).toBe(true);
  expect(body.cache_prompt).toBe(true);
  // Not allowed to read the document: only the instructions and the question.
  expect(body.messages[0].role).toBe('system');
  expect(body.messages[0].content).not.toContain('\\documentclass');
  expect(body.messages.at(-1)).toEqual({
    role: 'user',
    content: 'How do I italicise a word?',
  });

  // The conversation is the document's: it survives a reload.
  await page.waitForTimeout(300);
  await page.reload();
  await editorReady(page);
  await expect(log(page).getByRole('listitem')).toHaveCount(2);
});

test('the document is sent only once the author allows it, and only for that document', async ({
  page,
}) => {
  const seen = await mock(page, 'http://localhost:8080/v1/**', (route) =>
    sse(route, openaiStream('ok'))
  );
  await start(page);
  await chooseLocal(page);
  await setSource(
    page,
    '\\documentclass{article}\n\\begin{document}\nSecret draft.\n\\end{document}\n'
  );
  await openChat(page);
  const read = panel(page).getByRole('checkbox', {
    name: 'Let the assistant read this document',
  });
  await expect(read).not.toBeChecked();
  await expect(panel(page)).toContainText('Only your messages are sent');
  await ask(page, 'one');
  await expect(log(page).getByRole('listitem')).toHaveCount(2);
  expect(seen[0].postDataJSON().messages[0].content).not.toContain(
    'Secret draft'
  );

  await read.check();
  await expect(panel(page)).toContainText(
    'Each message sends this document’s source to Local server (llama.cpp).'
  );
  await ask(page, 'two');
  await expect(log(page).getByRole('listitem')).toHaveCount(4);
  const system = seen[1].postDataJSON().messages[0].content as string;
  expect(system).toContain('<document name=');
  expect(system).toContain('Secret draft.');

  // Another document starts with its own, empty conversation and no access.
  await openView(page, 'Explorer');
  await page.getByRole('button', { name: 'New document' }).click();
  await expect(log(page).getByRole('listitem')).toHaveCount(0);
  await expect(read).not.toBeChecked();
});

test('Claude: the key from setup, the browser-access header, the default model', async ({
  page,
}) => {
  const seen = await mock(page, 'https://api.anthropic.com/**', (route) =>
    sse(route, claudeStream('Hello ', 'from Claude.'))
  );
  await start(page);
  await openChat(page);
  // No key yet: the pane says so, and the question waits.
  await ask(page, 'Hi');
  await expect(panel(page).getByRole('alert')).toHaveText(
    'Claude (Anthropic) needs an API key. Add one in Assistant setup.'
  );
  await expect(input(page)).toHaveValue('Hi');
  expect(seen).toHaveLength(0);

  await panel(page).getByRole('button', { name: 'Setup' }).click();
  await setup(page)
    .getByLabel('Claude (Anthropic) API key')
    .fill('sk-ant-test');
  await setup(page).getByLabel('Claude (Anthropic) API key').press('Tab');
  await expect(panel(page).getByRole('alert')).toBeHidden();
  await input(page).press('ControlOrMeta+Enter');
  await expect(log(page).getByRole('listitem').nth(1)).toContainText(
    'Hello from Claude.'
  );
  const req = seen[0];
  expect(req.url()).toBe('https://api.anthropic.com/v1/messages');
  const h = req.headers();
  expect(h['x-api-key']).toBe('sk-ant-test');
  expect(h['anthropic-version']).toBe('2026-10-21');
  expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
  const body = req.postDataJSON();
  expect(body.model).toBe('claude-opus-5-5');
  expect(body.stream).toBe(true);
  expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);

  // Keys aren't kept in page storage.
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('sk-ant-test');
});

test('OpenRouter and Gemini: their endpoints, a bearer key, a chosen model', async ({
  page,
}) => {
  const or = await mock(page, 'https://openrouter.ai/**', (route) =>
    sse(route, openaiStream('from OpenRouter'))
  );
  const gm = await mock(
    page,
    'https://generativelanguage.googleapis.com/**',
    (route, req) =>
      req.url().endsWith('/models')
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ data: [{ id: 'models/gemini-test' }] }),
          })
        : sse(route, openaiStream('from Gemini'))
  );
  await start(page);
  await openView(page, 'Assistant setup');
  const o = provider(page, 'OpenRouter');
  await o.getByRole('radio', { name: 'Use OpenRouter' }).check();
  await o.getByLabel('OpenRouter API key').fill('or-key');
  await o.getByLabel('OpenRouter API key').press('Tab');
  await openChat(page);
  await ask(page, 'a');
  await expect(log(page).getByRole('listitem').nth(1)).toContainText(
    'from OpenRouter'
  );
  expect(or[0].url()).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(or[0].headers().authorization).toBe('Bearer or-key');
  expect(or[0].postDataJSON().model).toBe('openrouter/auto');

  const g = provider(page, 'Gemini (Google)');
  await g.getByRole('radio', { name: 'Use Gemini (Google)' }).check();
  await g.getByLabel('Gemini (Google) API key').fill('g-key');
  await g.getByLabel('Gemini (Google) API key').press('Tab');
  await g.getByRole('button', { name: 'Load Gemini (Google) models' }).click();
  await expect(g.getByRole('status')).toHaveText(
    '1 models: choose one in Model.'
  );
  await g
    .getByLabel('Gemini (Google) model', { exact: true })
    .fill('gemini-test');
  await g.getByLabel('Gemini (Google) model', { exact: true }).press('Tab');
  await expect(panel(page)).toContainText('gemini-test');
  await ask(page, 'b');
  await expect(log(page).getByRole('listitem').nth(3)).toContainText(
    'from Gemini'
  );
  const chat = gm.find((r) => r.url().endsWith('/chat/completions'))!;
  expect(chat.url()).toBe(
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  );
  expect(chat.headers().authorization).toBe('Bearer g-key');
  expect(chat.postDataJSON().model).toBe('gemini-test');
});

test('errors are shown, the question is kept, and Test connection reports', async ({
  page,
}) => {
  let fail = true;
  await mock(page, 'http://localhost:8080/v1/**', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: '{"error":{"message":"Loading model"}}',
        })
      : sse(route, openaiStream('hello'))
  );
  await start(page);
  await chooseLocal(page);
  await openChat(page);
  await ask(page, 'Still there?');
  await expect(panel(page).getByRole('alert')).toHaveText(
    'HTTP 503: Loading model.'
  );
  await expect(input(page)).toHaveValue('Still there?');
  await expect(log(page).getByRole('listitem')).toHaveCount(0);

  fail = false;
  const local = provider(page, 'Local server (llama.cpp)');
  await local
    .getByRole('button', { name: 'Test Local server (llama.cpp) connection' })
    .click();
  await expect(local.getByRole('status')).toHaveText(
    'Connected: the model replied “hello”.'
  );
  // A server elsewhere on the network is refused.
  const url = local.getByLabel('Local server (llama.cpp) server address');
  await url.fill('http://192.168.1.9:8080/v1');
  await url.press('Tab');
  await expect(local.getByRole('status')).toHaveText(
    'A local server must be on this computer (localhost or 127.0.0.1).'
  );
});

test('Stop ends a reply and keeps what arrived', async ({ page }) => {
  await start(page);
  // A server that sends one piece, then nothing until the request is aborted.
  await page.route('http://localhost:8080/v1/**', () => {
    // Never fulfilled: the fetch hangs until Stop aborts it.
  });
  await chooseLocal(page);
  await openChat(page);
  await ask(page, 'Long question');
  const stop = panel(page).getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toBeHidden();
  await expect(log(page).getByRole('listitem').nth(1)).toContainText(
    '[Stopped.]'
  );
  await expect(panel(page).getByRole('button', { name: 'Send' })).toBeVisible();
});

const editorValue = (page: Page) =>
  page.evaluate(
    () =>
      (document.querySelector('latex-editor') as unknown as { value: string })
        .value
  );

/** Put the caret at the start of a line, then select `lines` whole lines. */
async function selectLines(page: Page, line: number, lines: number) {
  await page.locator('latex-editor .monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  for (let i = 0; i < lines; i++) await page.keyboard.press('Shift+ArrowDown');
}

const SOURCE =
  '\\documentclass{article}\n\\begin{document}\nFirst line.\nSecond line.\n\\end{document}\n';

test('asking about the selection sends those lines with the question, once', async ({
  page,
}) => {
  const seen = await mock(page, 'http://localhost:8080/v1/**', (route) =>
    sse(route, openaiStream('ok'))
  );
  await start(page);
  await chooseLocal(page);
  await setSource(page, SOURCE);
  await openChat(page);
  const askButton = panel(page).getByRole('button', {
    name: 'Ask about the selection (lines 3–4)',
  });
  await expect(askButton).toBeHidden();
  await selectLines(page, 3, 2);
  await askButton.click();
  await expect(panel(page)).toContainText(
    'Asking about lines 3–4; they are sent with your question.'
  );
  await expect(input(page)).toBeFocused();
  await ask(page, 'Is this clear?');
  await expect(log(page).getByRole('listitem')).toHaveCount(2);
  const body = seen[0].postDataJSON();
  expect(body.messages.at(-1).content).toBe(
    'About lines 3–4 of my document:\n\n```latex\nFirst line.\nSecond line.\n```\n\nIs this clear?'
  );
  // Whole-document access stays off.
  expect(body.messages[0].content).not.toContain('\\begin{document}');
  // The chip is used up.
  await expect(panel(page)).not.toContainText('Asking about');
  await ask(page, 'And now?');
  await expect(log(page).getByRole('listitem')).toHaveCount(4);
  expect(seen[1].postDataJSON().messages.at(-1).content).toBe('And now?');
});

test('Ctrl/⌘+Shift+A in the editor opens the chat about the selection; × removes it', async ({
  page,
}) => {
  await start(page);
  await setSource(page, SOURCE);
  await expect(panel(page)).toBeHidden();
  await selectLines(page, 4, 1);
  await page.keyboard.press('ControlOrMeta+Shift+a');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Asking about line 4;');
  await expect(input(page)).toBeFocused();
  await panel(page)
    .getByRole('button', { name: 'Don’t ask about the selection' })
    .click();
  await expect(panel(page)).not.toContainText('Asking about');
});

test('a suggested block is inserted at the cursor, or replaces the selection, in one undo step', async ({
  page,
}) => {
  await mock(page, 'http://localhost:8080/v1/**', (route) =>
    sse(route, openaiStream('Try:\n```latex\nNew line.\n```'))
  );
  await start(page);
  await chooseLocal(page);
  await setSource(page, SOURCE);
  await openChat(page);
  await ask(page, 'Suggest a line');
  const reply = log(page).getByRole('listitem').nth(1);
  // Your own message's quoted code has no Insert button; the reply's has.
  await expect(
    log(page)
      .getByRole('listitem')
      .nth(0)
      .getByRole('button', { name: /Insert|Replace/ })
  ).toHaveCount(0);

  // Caret at the start of line 4, nothing selected: inserted there.
  await selectLines(page, 4, 0);
  await reply
    .getByRole('button', { name: 'Insert this code at the cursor' })
    .click();
  await expect
    .poll(() => editorValue(page))
    .toBe(SOURCE.replace('Second line.', 'New line.Second line.'));
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => editorValue(page)).toBe(SOURCE);

  // A selection is replaced, and the button says so.
  await selectLines(page, 3, 1);
  const replace = reply.getByRole('button', {
    name: 'Replace the selection with this code',
  });
  await expect(replace).toHaveText('Replace selection');
  await replace.click();
  await expect
    .poll(() => editorValue(page))
    .toBe(SOURCE.replace('First line.\n', 'New line.'));
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => editorValue(page)).toBe(SOURCE);
});
