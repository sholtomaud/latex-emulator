/**
 * The tools the assistant's model may call (ADR 0025): read the document,
 * work with its comment threads, and use Zotero through our plugin. The
 * document and comment tools work only for a document the author let the
 * assistant read (ADR 0023 §3): comments quote its text. The Zotero tools
 * are the plugin's own definitions, so their schemas can't drift apart.
 * Pure: the document, the comments and the plugin are passed in.
 */
import { TOOLS as PLUGIN_TOOLS } from '../../zotero-plugin/src/tools.ts';
import type { CommentsController } from '../comments/comments-controller.ts';
import { canResolve } from '../comments/threads.ts';
import type { ToolCall, ToolDef } from './providers.ts';

export type ZoteroCall = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ ok: true; result: unknown } | { ok: false; message: string }>;

export interface AssistantToolDeps {
  /** The open document, or null when the author hasn't allowed reading it. */
  document: () => { name: string; source: string } | null;
  comments: CommentsController;
  zotero: ZoteroCall;
}

export interface ToolResult {
  content: string;
  isError?: true;
}

/** The plugin tools the assistant gets: search, read, and the Zettelkasten. */
const ZOTERO_TOOLS = new Set([
  'search_items',
  'get_item',
  'zettel_list',
  'zettel_get',
  'zettel_search',
  'zettel_create',
  'zettel_update',
  'zettel_link',
  'zettel_unlink',
  'zettel_tag',
]);

const object = (
  properties: Record<string, unknown>,
  required: string[] = []
) => ({ type: 'object', properties, required, additionalProperties: false });

const OWN_TOOLS: ToolDef[] = [
  {
    name: 'document_read',
    description:
      'The author’s LaTeX document, each line numbered ("12| …"). Quote its text exactly (without the numbers) when commenting.',
    parameters: object({}),
  },
  {
    name: 'comments_list',
    description:
      'The comment threads on the document: each with its id, the quoted text, who opened it (you = the author, assistant = you), open or resolved, and its messages.',
    parameters: object({}),
  },
  {
    name: 'comment_add',
    description:
      'Open a comment thread on an exact quote from the document. If the quote occurs more than once, give occurrence (1 = first).',
    parameters: object(
      {
        quote: { type: 'string', minLength: 1, maxLength: 2000 },
        text: { type: 'string', minLength: 1, maxLength: 4000 },
        occurrence: { type: 'integer', minimum: 1 },
      },
      ['quote', 'text']
    ),
  },
  {
    name: 'comment_reply',
    description: 'Reply in a comment thread.',
    parameters: object(
      {
        thread_id: { type: 'string' },
        text: { type: 'string', minLength: 1, maxLength: 4000 },
      },
      ['thread_id', 'text']
    ),
  },
  {
    name: 'comment_resolve',
    description:
      'Resolve a thread you (the assistant) opened, once the text addresses it. Threads the author opened only the author resolves: reply instead.',
    parameters: object({ thread_id: { type: 'string' } }, ['thread_id']),
  },
];

const PERMISSION =
  'The author hasn’t allowed you to read this document. Ask them to tick “Let the assistant read this document” in the assistant pane.';

const ok = (value: unknown): ToolResult => ({
  content: typeof value === 'string' ? value : JSON.stringify(value),
});
const fail = (message: string): ToolResult => ({
  content: message,
  isError: true,
});

export class AssistantTools {
  private deps: AssistantToolDeps;

  constructor(deps: AssistantToolDeps) {
    this.deps = deps;
  }

  definitions(): ToolDef[] {
    return [
      ...OWN_TOOLS,
      ...PLUGIN_TOOLS.filter((t) => ZOTERO_TOOLS.has(t.name)).map((t) => ({
        name: t.name,
        description: `Zotero: ${t.description}`,
        parameters: t.inputSchema as unknown as Record<string, unknown>,
      })),
    ];
  }

  async run(call: ToolCall): Promise<ToolResult> {
    const input = call.input;
    if (typeof input._invalidArguments === 'string')
      return fail(
        `The arguments for ${call.name} were not valid JSON: ${input._invalidArguments.slice(0, 200)}`
      );
    if (ZOTERO_TOOLS.has(call.name)) {
      const r = await this.deps.zotero(call.name, input);
      return r.ok ? ok(r.result) : fail(r.message);
    }
    const own = OWN_TOOLS.find((t) => t.name === call.name);
    if (!own) return fail(`Unknown tool ${call.name}.`);
    const doc = this.deps.document();
    if (!doc) return fail(PERMISSION);
    const comments = this.deps.comments;
    const str = (k: string) =>
      typeof input[k] === 'string' ? (input[k] as string) : '';
    switch (call.name) {
      case 'document_read':
        return ok(
          doc.source
            .split('\n')
            .map((line, i) => `${i + 1}| ${line}`)
            .join('\n')
        );
      case 'comments_list':
        return ok({
          threads: comments.store.getState().threads.map((t) => ({
            id: t.id,
            quote: t.anchor.quote,
            openedBy: t.openedBy,
            status: t.status,
            textGone: comments.isLost(t) || undefined,
            messages: t.messages.map((m) => ({
              author: m.author,
              text: m.text,
            })),
          })),
        });
      case 'comment_add': {
        const quote = str('quote');
        const at: number[] = [];
        for (
          let i = doc.source.indexOf(quote);
          quote && i >= 0;
          i = doc.source.indexOf(quote, i + 1)
        )
          at.push(i);
        if (!at.length)
          return fail(
            'That quote was not found in the document: quote it exactly.'
          );
        const which =
          typeof input.occurrence === 'number' ? input.occurrence : 0;
        if (at.length > 1 && !which)
          return fail(
            `That quote occurs ${at.length} times: give occurrence (1 to ${at.length}), or quote more of the sentence.`
          );
        const start = at[Math.max(0, (which || 1) - 1)];
        if (start === undefined)
          return fail(`There are only ${at.length} occurrences of that quote.`);
        const thread = await comments.add(
          { start, end: start + quote.length, quote },
          str('text'),
          'assistant'
        );
        return thread
          ? ok({ thread_id: thread.id })
          : fail('The comment was empty.');
      }
      case 'comment_reply':
      case 'comment_resolve': {
        const thread = comments.store
          .getState()
          .threads.find((t) => t.id === str('thread_id'));
        if (!thread) return fail(`No comment thread ${str('thread_id')}.`);
        if (call.name === 'comment_reply') {
          await comments.reply(thread.id, 'assistant', str('text'));
          return ok('Replied.');
        }
        if (!canResolve(thread, 'assistant'))
          return fail(
            'The author opened this thread: only the author resolves it. Reply instead, saying it can be resolved.'
          );
        await comments.resolve(thread.id, true, 'assistant');
        return ok('Resolved.');
      }
    }
    return fail(`Unknown tool ${call.name}.`);
  }
}
