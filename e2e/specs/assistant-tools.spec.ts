import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';
import { openView } from '../support/views.ts';

/**
 * Tools in the chat (ADR 0025): the model calls tools, each runs (the
 * document and comments in the app, zettels through the Zotero plugin),
 * results go back, and the answer arrives. The model and Zotero are mocked.
 */

const LLM = 'http://localhost:8080/v1/**';
const MCP = 'http://127.0.0.1:23119/latex-emulator/mcp';
const TOKEN = 'T'.repeat(43);
const SOURCE =
  '\\documentclass{article}\n\\begin{document}\nEnergy is the currency of systems \\citep{odum_environmental_1996}.\n\\end{document}\n';

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Assistant' });
const log = (page: Page) =>
  panel(page).getByRole('log', { name: 'Conversation' });

type Turn = { text?: string; call?: { name: string; args: unknown } };

/** A local model answering each request with the next turn; records bodies. */
async function model(page: Page, turns: Turn[]) {
  const bodies: {
    messages: { role: string; content: string }[];
    tools?: unknown[];
  }[] = [];
  await page.route(LLM, async (route: Route) => {
    bodies.push(route.request().postDataJSON());
    const t = turns.shift() ?? { text: 'Done.' };
    const events = [
      ...(t.text ? [{ choices: [{ delta: { content: t.text } }] }] : []),
      ...(t.call
        ? [
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call_${bodies.length}`,
                        function: {
                          name: t.call.name,
                          arguments: JSON.stringify(t.call.args),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ]
        : []),
    ];
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'access-control-allow-origin': '*',
      },
      body:
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') +
        'data: [DONE]\n\n',
    });
  });
  return bodies;
}

/** The plugin: pairs, and answers tools/call (or refuses a read-only token). */
async function plugin(page: Page, readOnly = false) {
  const calls: { name: string; arguments: unknown }[] = [];
  await page.route(MCP, async (route) => {
    const body = route.request().postDataJSON();
    const reply = (x: Record<string, unknown>) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin':
            route.request().headers().origin ?? '*',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: body.id, ...x }),
      });
    if (body.method === 'pair/request')
      return reply({ result: { token: TOKEN, scopes: body.params.scopes } });
    if (body.method === 'initialize')
      return reply({
        result: {
          serverInfo: { name: 'latex-emulator-zotero', version: '0.3.0' },
          _meta: { 'latex-emulator/zotero-version': '10.0.8' },
        },
      });
    calls.push(body.params);
    if (readOnly)
      return reply({
        error: {
          code: -32002,
          message: 'This client may not use zettel_create.',
        },
      });
    return reply({
      result: {
        content: [],
        structuredContent: {
          zettel: {
            id: '1',
            key: 'NOTE0001',
            title: body.params.arguments.title,
          },
        },
      },
    });
  });
  return calls;
}

async function setUp(page: Page) {
  await page.goto('/');
  await editorReady(page);
  await setSource(page, SOURCE);
  await openView(page, 'Assistant setup');
  await page
    .getByRole('group', { name: 'Local server (llama.cpp)' })
    .getByRole('radio', { name: 'Use Local server (llama.cpp)' })
    .check();
}

async function connectZotero(page: Page) {
  await openView(page, 'References');
  const section = page.getByRole('region', { name: 'Zotero plugin' });
  if (!(await section.isVisible()))
    await page.getByText('Zotero plugin', { exact: true }).click();
  await section.getByRole('button', { name: 'Connect' }).click();
  await expect(section).toContainText('Connected to Zotero');
}

async function ask(page: Page, text: string) {
  if (!(await panel(page).isVisible()))
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  const input = panel(page).getByLabel('Message the assistant');
  await input.fill(text);
  await input.press('ControlOrMeta+Enter');
}

test('the model makes a zettel through the plugin, and says so', async ({
  page,
}) => {
  const calls = await plugin(page);
  const bodies = await model(page, [
    {
      text: 'Making a zettel.',
      call: {
        name: 'zettel_create',
        args: { title: 'Energy is the currency of systems' },
      },
    },
    { text: 'Created zettel 1, in zk/inbox.' },
  ]);
  await setUp(page);
  await connectZotero(page);
  await ask(page, 'Make a zettel from my claim.');
  await expect(log(page)).toContainText('Created zettel 1, in zk/inbox.');
  await expect(log(page)).toContainText(
    '⚙ zettel_create(title: “Energy is the currency of systems”)'
  );
  await expect(log(page)).toContainText('→ {"zettel":{"id":"1"');
  // The plugin got the call with the app's token.
  expect(calls).toEqual([
    {
      name: 'zettel_create',
      arguments: { title: 'Energy is the currency of systems' },
      _meta: { 'latex-emulator/token': TOKEN },
    },
  ]);
  // The model was offered the tools and got the result back.
  const names = (bodies[0].tools as { function: { name: string } }[]).map(
    (t) => t.function.name
  );
  expect(names).toContain('zettel_create');
  expect(names).toContain('comment_add');
  expect(bodies[1].messages.at(-1)).toMatchObject({
    role: 'tool',
    tool_call_id: 'call_1',
  });
});

test('the model comments on the document, where the author allowed it to read', async ({
  page,
}) => {
  await model(page, [
    { call: { name: 'comment_add', args: { quote: 'systems', text: 'x' } } },
    { text: 'I couldn’t.' },
    {
      call: {
        name: 'comment_add',
        args: {
          quote: 'Energy is the currency',
          text: 'A metaphor: say what is exchanged.',
        },
      },
    },
    { text: 'I left a comment.' },
  ]);
  await setUp(page);
  // Not allowed: the tool says so, nothing is added.
  await ask(page, 'Try to comment.');
  await expect(log(page)).toContainText('I couldn’t.');
  await expect(log(page)).toContainText(
    '✗ The author hasn’t allowed you to read this document'
  );
  await openView(page, 'Comments');
  await expect(
    page
      .getByRole('list', { name: 'Comment threads' })
      .locator('.comment-thread')
  ).toHaveCount(0);

  await panel(page)
    .getByRole('checkbox', { name: 'Let the assistant read this document' })
    .check();
  await ask(page, 'Comment on my claim.');
  await expect(log(page)).toContainText('I left a comment.');
  const thread = page
    .getByRole('list', { name: 'Comment threads' })
    .locator('.comment-thread');
  await expect(thread).toHaveCount(1);
  await expect(thread).toContainText('“Energy is the currency”');
  await expect(thread).toContainText(
    /Assistant\s*A metaphor: say what is exchanged\./
  );
  await expect(page.locator('latex-editor .latex-comment')).toHaveText(
    'Energy is the currency'
  );
});

test('a connection made before the assistant could write says how to allow it', async ({
  page,
}) => {
  await plugin(page, true);
  await model(page, [
    { call: { name: 'zettel_create', args: { title: 'T' } } },
    { text: 'Zotero refused.' },
  ]);
  await setUp(page);
  await connectZotero(page);
  await ask(page, 'Make a zettel.');
  await expect(log(page)).toContainText('✗ Zotero lets this site read only.');
});

test('tools can be turned off for a model that has none', async ({ page }) => {
  const bodies = await model(page, [{ text: 'Plain chat.' }]);
  await setUp(page);
  await page
    .getByRole('checkbox', { name: 'Let Local server (llama.cpp) use tools' })
    .uncheck();
  await ask(page, 'Hi');
  await expect(log(page)).toContainText('Plain chat.');
  expect(bodies[0].tools).toBeUndefined();
});
