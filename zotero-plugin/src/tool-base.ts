/**
 * What every tool is, and what tools share: the error a caller should
 * read, and an item's summary. Kept apart so tools.ts and zettel-tools.ts
 * don't import each other.
 */
import { entryFromCsl } from '../../src/references/lookup.ts';
import type { ItemSummary, Scope } from './protocol.ts';
import type { PortItem, ZoteroPort } from './port.ts';
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

/** An item as tools report it. */
export function itemSummary(item: PortItem): ItemSummary {
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
