import { entryFromCsl } from '../../src/references/lookup.ts';
import type { ItemDetail, ItemSummary, Scope } from './protocol.ts';
import type { PortItem, ZoteroPort } from './port.ts';
import { validate } from './validate.ts';
import type { Schema } from './validate.ts';

/** A failure the caller should read: returned as an MCP tool error. */
export class ToolError extends Error {}

export interface Tool {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  inputSchema: Schema & { type: 'object' };
  annotations: { readOnlyHint: boolean };
  run(port: ZoteroPort, args: Record<string, unknown>): Promise<unknown>;
}

const KEY: Schema = {
  type: 'string',
  pattern: '^[A-Z0-9]{8}$',
  description: 'A Zotero item key, as returned by search_items.',
};

export const TOOLS: Tool[] = [
  {
    name: 'search_items',
    title: 'Search Zotero',
    description:
      'Search the Zotero library (titles, creators, years, tags) for references. Returns each item’s key, title, creators, year, citation key and a zotero:// link.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(port, args) {
      const limit = (args.limit as number | undefined) ?? 20;
      const items = await port.search(args.query as string, limit);
      return { items: items.map(summary) };
    },
  },
  {
    name: 'get_item',
    title: 'Get a Zotero item',
    description:
      'One Zotero item by key: all its fields, tags, attachments and its BibTeX (Better BibTeX’s if installed).',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: { key: KEY },
      required: ['key'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(port, args) {
      const key = args.key as string;
      const item = await port.getItem(key);
      if (!item) throw new ToolError(`No item with key ${key}.`);
      const detail: ItemDetail = {
        ...summary(item),
        fields: item.fields,
        tags: item.tags,
        bibtex: await port.bibtex(key),
        attachments: item.attachments,
      };
      return { item: detail };
    },
  },
];

export function toolsFor(scopes: readonly Scope[]): Tool[] {
  return TOOLS.filter((t) => scopes.includes(t.scope));
}

/** Check the arguments against the tool's schema, then run it. */
export async function runTool(
  port: ZoteroPort,
  name: string,
  args: unknown
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool ${name}.`);
  const problems = validate(tool.inputSchema, args);
  if (problems.length)
    throw new ToolError(`Invalid arguments: ${problems.join('; ')}.`);
  return tool.run(port, args as Record<string, unknown>);
}

function summary(item: PortItem): ItemSummary {
  return {
    key: item.key,
    itemType: item.itemType,
    title: item.fields.title ?? '',
    creators: item.creators.map(
      (c) => c.name ?? [c.lastName, c.firstName].filter(Boolean).join(', ')
    ),
    year: /\d{4}/.exec(item.fields.date ?? '')?.[0] ?? '',
    // Better BibTeX's or Zotero's key; else ours (ADR 0008), from the CSL.
    citationKey: item.citationKey || entryFromCsl(item.csl, new Set()).key,
    uri: `zotero://select/library/items/${item.key}`,
  };
}
