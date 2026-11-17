/**
 * The app's client for our Zotero plugin (ADR 0024): pairing and the
 * plugin's status. Zotero answers CORS preflights itself, so every request
 * is a "simple request": POST with a text/plain body and no other headers,
 * the token travelling in the JSON-RPC params' _meta.
 */
import {
  MCP_URL,
  PAIR_METHOD,
  PROTOCOL_VERSIONS,
  RPC,
  TOKEN_META_KEY,
  ZOTERO_VERSION_META_KEY,
} from '../../zotero-plugin/src/protocol.ts';
import { parseZoteroItems } from './zotero.ts';
import type { ZoteroSearch } from './zotero.ts';

export type FetchLike = (
  url: string,
  init: RequestInit
) => Promise<{ status: number; json(): Promise<unknown> }>;

export type PluginFailure =
  /** No answer: Zotero closed, the plugin missing, this site not allowed, or the browser blocked it. */
  | 'unreachable'
  | 'no-plugin'
  | 'forbidden'
  | 'refused'
  | 'busy'
  | 'unpaired'
  /** The connection may read, not write (paired before ADR 0025). */
  | 'read-only'
  | 'error';

type Outcome<T> = ({ ok: true } & T) | { ok: false; failure: PluginFailure };

export type PluginStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'pairing'; code: string }
  | { state: 'connected'; zoteroVersion: string; pluginVersion: string }
  | { state: 'failed'; failure: PluginFailure };

/** Four digits shown both here and in Zotero's dialog. */
export const pairingCode = (random: number) =>
  String(random % 10000).padStart(4, '0');

async function rpc(
  fetch: FetchLike,
  method: string,
  params: Record<string, unknown>
): Promise<Outcome<{ result: Record<string, unknown> }>> {
  let res;
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      credentials: 'omit',
      // Chromium's Local Network Access permission (ADR 0024).
      targetAddressSpace: 'loopback',
    } as RequestInit);
  } catch {
    return { ok: false, failure: 'unreachable' };
  }
  if (res.status === 401) return { ok: false, failure: 'unpaired' };
  if (res.status === 403) return { ok: false, failure: 'forbidden' };
  if (res.status === 404) return { ok: false, failure: 'no-plugin' };
  if (res.status !== 200) return { ok: false, failure: 'error' };
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (body && typeof body.error === 'object' && body.error) {
    const code = (body.error as { code?: unknown }).code;
    if (code === RPC.pairingRefused) return { ok: false, failure: 'refused' };
    if (code === RPC.pairingBusy) return { ok: false, failure: 'busy' };
    if (code === RPC.forbidden) return { ok: false, failure: 'read-only' };
    return { ok: false, failure: 'error' };
  }
  if (!body || typeof body.result !== 'object' || !body.result)
    return { ok: false, failure: 'error' };
  return { ok: true, result: body.result as Record<string, unknown> };
}

/** Ask Zotero to pair: the user allows it in a dialog showing `code`. */
export async function pairWithZotero(
  fetch: FetchLike,
  code: string
): Promise<Outcome<{ token: string }>> {
  const r = await rpc(fetch, PAIR_METHOD, {
    name: 'LaTeX Emulator',
    code,
    // The assistant writes zettels (ADR 0025); Zotero's dialog says so.
    scopes: ['read', 'write-notes'],
  });
  if (!r.ok) return r;
  const token = r.result.token;
  return typeof token === 'string'
    ? { ok: true, token }
    : { ok: false, failure: 'error' };
}

/** MCP initialize with our token: is it still paired, and which versions. */
export async function zoteroPluginInfo(
  fetch: FetchLike,
  token: string
): Promise<Outcome<{ zoteroVersion: string; pluginVersion: string }>> {
  const r = await rpc(fetch, 'initialize', {
    protocolVersion: PROTOCOL_VERSIONS[0],
    capabilities: {},
    clientInfo: { name: 'latex-emulator', version: '1' },
    _meta: { [TOKEN_META_KEY]: token },
  });
  if (!r.ok) return r;
  const meta = (r.result._meta ?? {}) as Record<string, unknown>;
  const server = (r.result.serverInfo ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    zoteroVersion: String(meta[ZOTERO_VERSION_META_KEY] ?? ''),
    pluginVersion: String(server.version ?? ''),
  };
}

const FAILURES: Record<PluginFailure, string> = {
  unreachable:
    'Zotero didn’t answer. Start Zotero with the plugin installed, and if the browser asks whether this site may reach devices on your computer or network, allow it.',
  'no-plugin':
    'Zotero is running, but the plugin isn’t installed. Get the plugin, then install it from Zotero’s Plugins window.',
  forbidden:
    'The plugin doesn’t allow this site. Add it under Zotero → Settings → LaTeX Emulator → Websites allowed to connect.',
  refused: 'The connection was declined in Zotero.',
  busy: 'Zotero is already asking about another connection. Answer that first.',
  unpaired:
    'This connection was removed in Zotero. Connect again to make a new one.',
  'read-only':
    'Zotero lets this site read only. To let the assistant write zettels: References → Zotero plugin → Disconnect, then Connect, and allow it in Zotero.',
  error: 'Something went wrong talking to the plugin. Try again.',
};

export function pluginStatusText(status: PluginStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Not connected.';
    case 'checking':
      return 'Looking for Zotero…';
    case 'pairing':
      return `In Zotero, check that the code is ${status.code.split('').join(' ')}, then click Allow.`;
    case 'connected':
      return `Connected to Zotero ${status.zoteroVersion} (plugin ${status.pluginVersion}).`;
    case 'failed':
      return FAILURES[status.failure];
  }
}

const UPDATE_PLUGIN =
  'Update the LaTeX Emulator plugin in Zotero (Tools → Plugins → ⚙ → Check for Updates) to search your library from here.';

/**
 * Search the library through the plugin's `search_items`, asking for each
 * item's CSL-JSON so hits become .bib entries the same way as the web
 * API's (ADR 0009, ADR 0024). Zotero's own local API drops requests from
 * web pages; the plugin is how this site reaches the library on this
 * computer.
 */
export async function searchViaPlugin(
  fetch: FetchLike,
  token: string,
  query: string
): Promise<ZoteroSearch> {
  const q = query.trim();
  if (!q) return { ok: false, message: 'Type something to search for.' };
  const r = await rpc(fetch, 'tools/call', {
    name: 'search_items',
    arguments: { query: q, limit: 25, include_csl: true },
    _meta: { [TOKEN_META_KEY]: token },
  });
  if (!r.ok) return { ok: false, message: FAILURES[r.failure] };
  if (r.result.isError) {
    const content = r.result.content as { text?: unknown }[] | undefined;
    const text = String(content?.[0]?.text ?? '');
    // Plugin 0.1.0 doesn't know include_csl.
    return {
      ok: false,
      message: /include_csl/.test(text)
        ? UPDATE_PLUGIN
        : text || FAILURES.error,
    };
  }
  const items = (r.result.structuredContent as { items?: unknown } | undefined)
    ?.items;
  if (!Array.isArray(items)) return { ok: false, message: FAILURES.error };
  const csl = items.map((i) => (i as { csl?: unknown } | null)?.csl);
  if (items.length && csl.every((c) => c === undefined))
    return { ok: false, message: UPDATE_PLUGIN };
  return { ok: true, hits: parseZoteroItems(csl) };
}

/** Call one of the plugin's tools (ADR 0025): its result, or why not. */
export async function callPluginTool(
  fetch: FetchLike,
  token: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ ok: true; result: unknown } | { ok: false; message: string }> {
  const r = await rpc(fetch, 'tools/call', {
    name,
    arguments: args,
    _meta: { [TOKEN_META_KEY]: token },
  });
  if (!r.ok) return { ok: false, message: FAILURES[r.failure] };
  if (r.result.isError) {
    const content = r.result.content as { text?: unknown }[] | undefined;
    return {
      ok: false,
      message: String(content?.[0]?.text ?? '') || FAILURES.error,
    };
  }
  return { ok: true, result: r.result.structuredContent ?? null };
}
