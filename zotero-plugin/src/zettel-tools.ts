/**
 * The Zettelkasten tools (ADR 0024 §5): zettels are standalone notes in
 * one collection, named by the Luhmann ID that starts their first line,
 * linked to each other and to their sources by Zotero's Related relation.
 * Reading needs `read`; writing needs `write-notes`. New zettels are
 * tagged zk/inbox; nothing is ever deleted.
 */
import type { PortNote, ZoteroPort } from './port.ts';
import type {
  SourceRef,
  ZettelDetail,
  ZettelRef,
  ZettelSummary,
} from './protocol.ts';
import { INBOX_TAG } from './protocol.ts';
import {
  compareIds,
  firstFreeChild,
  isId,
  isUnder,
  nextFreeTopLevel,
  parent,
  placeAfter,
} from './luhmann.ts';
import { parseZettel, retitle, zettelHtml } from './zettel-note.ts';
import type { ZettelText } from './zettel-note.ts';
import type { Schema } from './validate.ts';
import type { Tool } from './tool-base.ts';
import { ToolError, itemSummary } from './tool-base.ts';

interface Zettel extends ZettelText {
  note: PortNote;
}

// No pattern: checkId's message says what a Luhmann ID is.
const ID: Schema = {
  type: 'string',
  minLength: 1,
  maxLength: 40,
  description: 'A Luhmann ID, such as 1a2.',
};
const KEY: Schema = {
  type: 'string',
  pattern: '^[A-Z0-9]{8}$',
  description: 'A Zotero item key, as returned by search_items.',
};
const TAGS: Schema = {
  type: 'array',
  items: { type: 'string', minLength: 1, maxLength: 100 },
};

/** Every zettel, in Luhmann order (a duplicated ID: the first is kept). */
async function zettels(port: ZoteroPort): Promise<Zettel[]> {
  const seen = new Set<string>();
  const out: Zettel[] = [];
  for (const note of await port.zettelNotes()) {
    const z = parseZettel(note.html);
    if (!z || seen.has(z.id)) continue;
    seen.add(z.id);
    out.push({ ...z, note });
  }
  return out.sort((a, b) => compareIds(a.id, b.id));
}

const ref = (z: Zettel): ZettelRef => ({ id: z.id, title: z.title });
const summary = (z: Zettel): ZettelSummary => ({
  ...ref(z),
  key: z.note.key,
  tags: z.note.tags,
});

function checkId(id: string): void {
  if (!isId(id))
    throw new ToolError(
      `${id} is not a Luhmann ID (numbers and letters alternating, such as 1a2).`
    );
}

function find(all: Zettel[], id: string): Zettel {
  checkId(id);
  const z = all.find((x) => x.id === id);
  if (!z) throw new ToolError(`No zettel ${id}.`);
  return z;
}

async function detail(port: ZoteroPort, all: Zettel[], z: Zettel) {
  const byKey = new Map(all.map((x) => [x.note.key, x]));
  const links: ZettelRef[] = [];
  const sources: SourceRef[] = [];
  for (const key of z.note.related) {
    const linked = byKey.get(key);
    if (linked) {
      links.push(ref(linked));
      continue;
    }
    const item = await port.getItem(key);
    if (item) {
      const s = itemSummary(item);
      sources.push({ key: s.key, title: s.title, citationKey: s.citationKey });
    }
  }
  const at = all.indexOf(z);
  const up = all.find((x) => x.id === parent(z.id));
  const result: ZettelDetail = {
    ...summary(z),
    body: z.body,
    uri: `zotero://select/library/items/${z.note.key}`,
    links: links.sort((a, b) => compareIds(a.id, b.id)),
    sources,
    parent: up ? ref(up) : null,
    children: all.filter((x) => parent(x.id) === z.id).map(ref),
    previous: at > 0 ? ref(all[at - 1]) : null,
    next: at < all.length - 1 ? ref(all[at + 1]) : null,
  };
  return result;
}

// Writes one at a time, so two creates can't pick the same ID.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/** `zettel` or `item`, exactly one: the other end of a link. */
async function target(
  port: ZoteroPort,
  all: Zettel[],
  z: Zettel,
  args: Record<string, unknown>
): Promise<string> {
  const zettel = args.zettel as string | undefined;
  const item = args.item as string | undefined;
  if ((zettel === undefined) === (item === undefined))
    throw new ToolError('Give either a zettel or an item to link.');
  if (zettel !== undefined) {
    const other = find(all, zettel);
    if (other === z) throw new ToolError('A zettel can’t link to itself.');
    return other.note.key;
  }
  if (!(await port.getItem(item!))) throw new ToolError(`No item ${item}.`);
  return item!;
}

const write = { readOnlyHint: false };
const read = { readOnlyHint: true };

export const ZETTEL_TOOLS: Tool[] = [
  {
    name: 'zettel_list',
    title: 'List zettels',
    description:
      'The Zettelkasten’s zettels in Luhmann order, each with its ID, title, note key and tags. With a prefix (such as 1a), only that branch.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: { prefix: ID },
      additionalProperties: false,
    },
    annotations: read,
    async run(port, args) {
      const prefix = args.prefix as string | undefined;
      if (prefix !== undefined) checkId(prefix);
      const all = await zettels(port);
      return {
        zettels: all
          .filter((z) => prefix === undefined || isUnder(z.id, prefix))
          .map(summary),
      };
    },
  },
  {
    name: 'zettel_get',
    title: 'Get a zettel',
    description:
      'One zettel by Luhmann ID: its title and body, the zettels and sources it is linked to, its parent and children, and its neighbours in the sequence.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: ID },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: read,
    async run(port, args) {
      const all = await zettels(port);
      return { zettel: await detail(port, all, find(all, args.id as string)) };
    },
  },
  {
    name: 'zettel_search',
    title: 'Search zettels',
    description:
      'Zettels whose title or body contains every word of the query (case-insensitive), in Luhmann order.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: read,
    async run(port, args) {
      const words = (args.query as string)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const all = await zettels(port);
      return {
        zettels: all
          .filter((z) => {
            const text = `${z.title}\n${z.body}`.toLowerCase();
            return words.every((w) => text.includes(w));
          })
          .map(summary),
      };
    },
  },
  {
    name: 'zettel_create',
    title: 'Create a zettel',
    description:
      'A new zettel: after an ID (its next sibling, or a branch under it if that is taken), under an ID (its next child), or a new top-level ID. Linked to the given source items and zettels, and tagged zk/inbox until the user accepts it.',
    scope: 'write-notes',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        body: { type: 'string', maxLength: 20000 },
        after: ID,
        under: ID,
        sources: { type: 'array', items: KEY },
        links: { type: 'array', items: ID },
      },
      required: ['title'],
      additionalProperties: false,
    },
    annotations: write,
    run: (port, args) =>
      serial(async () => {
        const title = (args.title as string).trim();
        if (!title) throw new ToolError('A zettel needs a title.');
        const after = args.after as string | undefined;
        const under = args.under as string | undefined;
        if (after !== undefined && under !== undefined)
          throw new ToolError('Give either after or under, not both.');
        const all = await zettels(port);
        const taken = new Set(all.map((z) => z.id));
        const sources = (args.sources as string[] | undefined) ?? [];
        const links = ((args.links as string[] | undefined) ?? []).map(
          (id) => find(all, id).note.key
        );
        for (const key of sources)
          if (!(await port.getItem(key)))
            throw new ToolError(`No item ${key}.`);
        const id =
          after !== undefined
            ? (find(all, after), placeAfter(after, taken))
            : under !== undefined
              ? (find(all, under), firstFreeChild(under, taken))
              : nextFreeTopLevel(taken);
        const key = await port.createZettelNote(
          zettelHtml(id, title, (args.body as string | undefined) ?? ''),
          [INBOX_TAG]
        );
        for (const other of [...sources, ...links])
          await port.relate(key, other, true);
        return { zettel: { id, key, title } };
      }),
  },
  {
    name: 'zettel_update',
    title: 'Change a zettel',
    description:
      'Change a zettel’s title, its body, or both; its ID stays. A new title keeps the body as it is; a new body replaces it with plain paragraphs.',
    scope: 'write-notes',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        title: { type: 'string', minLength: 1, maxLength: 300 },
        body: { type: 'string', maxLength: 20000 },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: write,
    run: (port, args) =>
      serial(async () => {
        const title = (args.title as string | undefined)?.trim();
        const body = args.body as string | undefined;
        if (!title && body === undefined)
          throw new ToolError('Give a title or a body to change.');
        const z = find(await zettels(port), args.id as string);
        const html =
          body !== undefined
            ? zettelHtml(z.id, title || z.title, body)
            : retitle(z.note.html, `${z.id} ${title}`);
        await port.setNoteHtml(z.note.key, html);
        return {
          zettel: { id: z.id, key: z.note.key, title: title || z.title },
        };
      }),
  },
  ...(['zettel_link', 'zettel_unlink'] as const).map((name): Tool => ({
    name,
    title: name === 'zettel_link' ? 'Link a zettel' : 'Unlink a zettel',
    description:
      name === 'zettel_link'
        ? 'Link a zettel to another zettel (by ID) or to a source item (by key), with Zotero’s Related relation, which works both ways.'
        : 'Remove a Related link between a zettel and another zettel (by ID) or a source item (by key).',
    scope: 'write-notes',
    inputSchema: {
      type: 'object',
      properties: { id: ID, zettel: ID, item: KEY },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: write,
    run: (port, args) =>
      serial(async () => {
        const all = await zettels(port);
        const z = find(all, args.id as string);
        const other = await target(port, all, z, args);
        await port.relate(z.note.key, other, name === 'zettel_link');
        return {
          zettel: ref(z),
          [name === 'zettel_link' ? 'linked' : 'unlinked']: other,
        };
      }),
  })),
  {
    name: 'zettel_tag',
    title: 'Tag a zettel',
    description:
      'Add or remove tags on a zettel. Removing zk/inbox accepts an agent’s zettel into the Zettelkasten.',
    scope: 'write-notes',
    inputSchema: {
      type: 'object',
      properties: { id: ID, add: TAGS, remove: TAGS },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: write,
    run: (port, args) =>
      serial(async () => {
        const add = (args.add as string[] | undefined) ?? [];
        const remove = (args.remove as string[] | undefined) ?? [];
        if (!add.length && !remove.length)
          throw new ToolError('Give tags to add or remove.');
        const z = find(await zettels(port), args.id as string);
        await port.setTags(z.note.key, add, remove);
        const tags = [...new Set([...z.note.tags, ...add])].filter(
          (t) => !remove.includes(t)
        );
        return { zettel: { ...ref(z), key: z.note.key, tags } };
      }),
  },
];
