/**
 * What the plugin core needs from Zotero. `zotero/port.ts` implements it
 * with Zotero's JavaScript API; tests use `fake-port.ts`. Keeping Zotero
 * behind this keeps the core pure and unit-tested (ADR 0024 §7).
 */
export interface PortCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** A single-field name, such as an institution. */
  name?: string;
}

export interface PortItem {
  key: string;
  itemType: string;
  fields: Record<string, string>;
  creators: PortCreator[];
  tags: string[];
  /** Better BibTeX's key, or Zotero's own citationKey field; null if neither. */
  citationKey: string | null;
  /** The item as CSL-JSON, for our own key when there is none. */
  csl: Record<string, unknown>;
  attachments: { key: string; title: string; contentType: string }[];
}

export interface ZoteroPort {
  /** Regular items (not notes or attachments) in the user's library. */
  search(query: string, limit: number): Promise<PortItem[]>;
  getItem(key: string): Promise<PortItem | null>;
  bibtex(key: string): Promise<string>;
}
