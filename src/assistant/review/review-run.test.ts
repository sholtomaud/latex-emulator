import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_SYSTEM, reviewParagraph } from './review-run.ts';
import { paragraphs } from './paragraphs.ts';
import { SYSTEM_PROMPT, TOOL_GUIDE } from '../context.ts';
import type { ToolCall } from '../providers.ts';
import type { Thread } from '../../comments/threads.ts';

const A =
  'Energy is the currency of all systems, and its flows shape them \\citep{odum_environmental_1996}.';
const B =
  'Each transformation degrades some energy, so hierarchies form in every ecosystem we study.';
const SOURCE = `\\begin{document}\n${A}\n\n${B}\n\\end{document}`;

type Turn =
  | { text?: string; call?: { name: string; args: string } }
  | { status: number; body: string };

/** A local server answering each request with the next turn. */
function server(turns: Turn[]) {
  const bodies: {
    messages: { role: string; content: string }[];
    tools?: unknown[];
  }[] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    const t = turns.shift() ?? { text: 'Done.' };
    if ('status' in t) return new Response(t.body, t);
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
                        id: `c${bodies.length}`,
                        function: { name: t.call.name, arguments: t.call.args },
                      },
                    ],
                  },
                },
              ],
            },
          ]
        : []),
    ];
    return new Response(
      [...events.map((e) => JSON.stringify(e)), '[DONE]']
        .map((e) => `data: ${e}\n\n`)
        .join(''),
      { status: 200 }
    );
  };
  return { fetch, bodies };
}

const cfg = {
  provider: 'local' as const,
  baseUrl: 'http://localhost:8080/v1',
  model: '',
};

function deps(
  turns: Turn[],
  { problem = null as string | null, threads = [] as Thread[] } = {}
) {
  const s = server(turns);
  const ran: ToolCall[] = [];
  const scopes: number[] = [];
  return {
    s,
    ran,
    scopes,
    d: {
      fetch: s.fetch,
      config: () => cfg,
      problem: () => problem,
      name: () => 'Thesis',
      threads: () => threads,
      tools: (job: { index: number }) => {
        scopes.push(job.index);
        return {
          definitions: () => [
            {
              name: 'comment_add',
              description: 'd',
              parameters: { type: 'object' },
            },
          ],
          run: async (c: ToolCall) => {
            ran.push(c);
            return { content: '{"thread_id":"t1"}' };
          },
        };
      },
    },
  };
}

const job = {
  documentId: 'd',
  source: SOURCE,
  paragraphs: paragraphs(SOURCE),
  index: 1,
};

test('the reviewer’s fixed instructions: the chat’s, its tool guide, then the review rules', () => {
  assert.ok(REVIEW_SYSTEM.startsWith(`${SYSTEM_PROMPT}\n\n${TOOL_GUIDE}\n\n`));
  assert.match(REVIEW_SYSTEM, /one paragraph at a time/);
});

test('a paragraph is reviewed with tools scoped to it, and the summary comes back', async () => {
  const t = deps([
    {
      call: {
        name: 'comment_add',
        args: '{"quote":"Each transformation","text":"Which?"}',
      },
    },
    { text: 'Left one comment.\nMore detail.' },
  ]);
  const summary = await reviewParagraph(t.d, job, new AbortController().signal);
  assert.equal(summary, 'Left one comment.');
  assert.deepEqual(t.scopes, [1]);
  assert.equal(t.ran[0].name, 'comment_add');
  const first = t.s.bodies[0];
  assert.equal(first.messages[0].role, 'system');
  assert.equal(first.messages[0].content, REVIEW_SYSTEM);
  assert.match(
    first.messages[1].content,
    /^Review paragraph 2 of 2 of “Thesis”/
  );
  assert.ok(
    first.messages[1].content.includes(`<paragraph>\n${B}\n</paragraph>`)
  );
  assert.equal(first.tools!.length, 1);
});

test('the paragraph’s own threads go with it', async () => {
  const p = job.paragraphs[1];
  const on: Thread = {
    id: 'mine',
    anchor: { start: p.start, end: p.start + 4, quote: 'Each' },
    openedBy: 'you',
    status: 'open',
    messages: [{ author: 'you', text: 'Is this true?', at: 1 }],
    updatedAt: 1,
  };
  const elsewhere: Thread = {
    ...on,
    id: 'other',
    anchor: { start: 0, end: 4, quote: '\\beg' },
  };
  const t = deps([{ text: 'Replied.' }], { threads: [on, elsewhere] });
  await reviewParagraph(t.d, job, new AbortController().signal);
  const m = t.s.bodies[0].messages[1].content;
  assert.ok(m.includes('"id":"mine"'));
  assert.ok(!m.includes('"id":"other"'));
});

test('no reply text: a plain summary', async () => {
  const t = deps([{ text: '' }]);
  assert.equal(
    await reviewParagraph(t.d, job, new AbortController().signal),
    'Reviewed.'
  );
});

test('a setup problem or a failing provider throws, with what to do', async () => {
  const t = deps([], { problem: 'Claude needs an API key.' });
  await assert.rejects(
    reviewParagraph(t.d, job, new AbortController().signal),
    /needs an API key/
  );
  assert.equal(t.s.bodies.length, 0);
  const f = deps([
    {
      status: 500,
      body: '{"error":{"message":"tools param requires --jinja flag"}}',
    },
  ]);
  await assert.rejects(
    reviewParagraph(f.d, job, new AbortController().signal),
    /--jinja and a model that calls tools/
  );
});
