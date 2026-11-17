import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';
import { openView } from '../support/views.ts';

/**
 * The reviewing agent (ADR 0025 §3): with "Review as I write" on, a pause
 * in typing sends each paragraph not yet reviewed to the chat's model,
 * whose comments land on that paragraph. The model is mocked.
 */

const LLM = 'http://localhost:8080/v1/**';
const A =
  'Energy is the currency of all systems, and its flows shape every one of them.';
const B =
  'Each transformation degrades some energy, so hierarchies form in every ecosystem.';
const doc = (...ps: string[]) =>
  `\\documentclass{article}\n\\begin{document}\n${ps.join('\n\n')}\n\\end{document}\n`;

type Body = {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
};

/** A model that comments on the energy paragraph and passes the others. */
async function model(page: Page) {
  const reviews: string[] = [];
  await page.route(LLM, async (route: Route) => {
    const body: Body = route.request().postDataJSON();
    const last = body.messages.at(-1)!;
    let event: unknown;
    if (last.role === 'tool')
      event = { choices: [{ delta: { content: 'Left a comment.' } }] };
    else {
      const para = /<paragraph>\n([\s\S]*?)\n<\/paragraph>/.exec(
        last.content
      )![1];
      reviews.push(para);
      event = para.startsWith('Energy')
        ? {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_${reviews.length}`,
                      function: {
                        name: 'comment_add',
                        arguments: JSON.stringify({
                          quote: 'the currency of all systems',
                          text: 'A metaphor: say what is exchanged.',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }
        : { choices: [{ delta: { content: 'Nothing to add.' } }] };
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'access-control-allow-origin': '*',
      },
      body: `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,
    });
  });
  return reviews;
}

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Assistant' });

async function setUp(page: Page) {
  await page.goto('/');
  await editorReady(page);
  await setSource(page, doc(A, B));
  await openView(page, 'Assistant setup');
  await page
    .getByRole('group', { name: 'Local server (llama.cpp)' })
    .getByRole('radio', { name: 'Use Local server (llama.cpp)' })
    .check();
  if (!(await panel(page).isVisible()))
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
}

test('review as I write: each paragraph once, comments on the right one, an edit sends only that paragraph', async ({
  page,
}) => {
  const reviews = await model(page);
  await setUp(page);
  const on = panel(page).getByRole('checkbox', { name: 'Review as I write' });
  // Reviewing reads the document: allowed first.
  await expect(on).toBeDisabled();
  await panel(page)
    .getByRole('checkbox', { name: 'Let the assistant read this document' })
    .check();
  await on.check();
  const status = panel(page).getByRole('status');
  await expect(status).toHaveText(
    'All paragraphs reviewed. Last: Nothing to add.',
    { timeout: 15_000 }
  );
  expect(reviews).toEqual([A, B]);
  await openView(page, 'Comments');
  const thread = page
    .getByRole('list', { name: 'Comment threads' })
    .locator('.comment-thread');
  await expect(thread).toHaveCount(1);
  await expect(thread).toContainText('“the currency of all systems”');
  await expect(thread).toContainText('A metaphor: say what is exchanged.');
  // Only the changed paragraph goes again.
  const B2 = B.replace('every ecosystem', 'every living ecosystem');
  await setSource(page, doc(A, B2));
  await expect.poll(() => reviews.length, { timeout: 15_000 }).toBe(3);
  expect(reviews[2]).toBe(B2);
  // The chat's own conversation is untouched.
  await expect(
    panel(page).getByRole('log', { name: 'Conversation' }).locator('li')
  ).toHaveCount(0);
});

test('review the whole document with the switch off; a failure pauses it and says why', async ({
  page,
}) => {
  let fail = true;
  const reviews: string[] = [];
  await page.route(LLM, async (route) => {
    if (fail)
      return route.fulfill({
        status: 500,
        headers: { 'access-control-allow-origin': '*' },
        body: '{"error":{"message":"model not loaded"}}',
      });
    reviews.push('x');
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'access-control-allow-origin': '*',
      },
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'Fine.' } }] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await setUp(page);
  const all = panel(page).getByRole('button', {
    name: 'Review whole document',
  });
  await expect(all).toBeDisabled();
  await panel(page)
    .getByRole('checkbox', { name: 'Let the assistant read this document' })
    .check();
  await all.click();
  const status = panel(page).getByRole('status');
  await expect(status).toContainText('Review paused:');
  await expect(status).toContainText('model not loaded');
  fail = false;
  await all.click();
  await expect.poll(() => reviews.length).toBe(2);
  await expect(all).toBeEnabled();
  await expect(
    panel(page).getByRole('checkbox', { name: 'Review as I write' })
  ).not.toBeChecked();
});
