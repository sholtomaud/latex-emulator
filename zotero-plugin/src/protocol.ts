/**
 * What the plugin and the app agree on (ADR 0024): where the endpoint is,
 * how a web page passes its token, the pairing method, and the shapes the
 * read tools return. Shared by `zotero-plugin/` and `src/references/`.
 */

/** Zotero's own server, which the plugin adds an endpoint to. */
export const ZOTERO_PORT = 23119;
export const MCP_PATH = '/latex-emulator/mcp';
export const MCP_URL = `http://127.0.0.1:${ZOTERO_PORT}${MCP_PATH}`;

/** MCP protocol revisions we speak, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

/**
 * A web page can't send an Authorization header without a CORS preflight,
 * which Zotero's server answers itself without CORS headers. So the app
 * puts its token in the request's `params._meta` under this key.
 */
export const TOKEN_META_KEY = 'latex-emulator/token';

/** initialize's result `_meta` key for the running Zotero's version. */
export const ZOTERO_VERSION_META_KEY = 'latex-emulator/zotero-version';

/** Our own JSON-RPC method (not MCP's): ask the user to pair a client. */
export const PAIR_METHOD = 'pair/request';

export const SCOPES = ['read', 'write-notes', 'write-items'] as const;
export type Scope = (typeof SCOPES)[number];

export interface PairParams {
  /** Shown in Zotero's dialog: who is asking. */
  name: string;
  /** Four digits the asking app also shows, so the user can match them. */
  code: string;
  scopes: Scope[];
}

export interface PairResult {
  token: string;
  scopes: Scope[];
}

/** JSON-RPC error codes: the standard ones and ours (-32000 to -32099). */
export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  unauthorized: -32001,
  forbidden: -32002,
  pairingBusy: -32003,
  pairingRefused: -32004,
} as const;

export interface ItemSummary {
  /** Zotero's item key in the user's library. */
  key: string;
  itemType: string;
  title: string;
  /** "Last, First" or an institution's name, in order. */
  creators: string[];
  year: string;
  /** Better BibTeX's key, else Zotero's citationKey field, else ours. */
  citationKey: string;
  /** Opens the item in Zotero. */
  uri: string;
}

export interface ItemDetail extends ItemSummary {
  fields: Record<string, string>;
  tags: string[];
  /** The item as BibTeX, from Better BibTeX if installed, else Zotero. */
  bibtex: string;
  attachments: { key: string; title: string; contentType: string }[];
}

/** Agents' new zettels wait here until the user accepts them (ADR 0024 §3). */
export const INBOX_TAG = 'zk/inbox';

/** A zettel named by its Luhmann ID (ADR 0024 §4). */
export interface ZettelRef {
  id: string;
  title: string;
}

export interface ZettelSummary extends ZettelRef {
  /** The note's Zotero item key. */
  key: string;
  tags: string[];
}

/** A source a zettel draws on: a regular item it is Related to. */
export interface SourceRef {
  key: string;
  title: string;
  citationKey: string;
}

export interface ZettelDetail extends ZettelSummary {
  body: string;
  uri: string;
  /** Related zettels. */
  links: ZettelRef[];
  sources: SourceRef[];
  parent: ZettelRef | null;
  children: ZettelRef[];
  /** Neighbours in Luhmann order. */
  previous: ZettelRef | null;
  next: ZettelRef | null;
}
