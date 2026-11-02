/**
 * Search a Zotero library and get CSL-JSON back, from Zotero 7 running on
 * this computer (its local API on port 23119) or from the zotero.org web
 * library (user ID + API key). Both speak the same Web API v3 with
 * format=csljson, so results go through the DOI converter (csl.ts) and get
 * author_topic_year keys. `fetch` is injected so this stays testable.
 */

export type ZoteroSource =
  { kind: 'local' } | { kind: 'web'; userId: string; apiKey: string };

export interface ZoteroHit {
  title: string;
  /** "Brown and Ulgiati", "Hall et al." */
  creators: string;
  year: string;
  /** The CSL-JSON item, for cslToEntry. */
  csl: unknown;
}

export type ZoteroSearch =
  { ok: true; hits: ZoteroHit[] } | { ok: false; message: string };

const LOCAL_API = 'http://localhost:23119/api';
const WEB_API = 'https://api.zotero.org';
const LIMIT = 25;

/** The request for a search of the library's top-level items. */
export function zoteroSearchRequest(
  source: ZoteroSource,
  query: string,
  limit = LIMIT
): { url: string; headers: Record<string, string> } {
  // The version is a query parameter, not a Zotero-API-Version header: any
  // custom header makes the browser send a CORS preflight (OPTIONS), which
  // Zotero's local server does not answer.
  const params = new URLSearchParams({
    v: '3',
    format: 'csljson',
    limit: String(limit),
    q: query,
  });
  const base =
    source.kind === 'local'
      ? `${LOCAL_API}/users/0` // the local API's name for "my library"
      : `${WEB_API}/users/${encodeURIComponent(source.userId)}`;
  // zotero.org answers preflights, so the key can travel as a header there.
  const headers: Record<string, string> =
    source.kind === 'web' ? { 'Zotero-API-Key': source.apiKey } : {};
  return { url: `${base}/items/top?${params}`, headers };
}

type Csl = Record<string, unknown>;

function family(n: Csl): string {
  return String(n.family ?? n.literal ?? '').trim();
}

/** Titled items from a csljson answer ({ items: [...] } or a bare array). */
export function parseZoteroItems(json: unknown): ZoteroHit[] {
  const items = Array.isArray(json)
    ? json
    : Array.isArray((json as { items?: unknown } | null)?.items)
      ? (json as { items: unknown[] }).items
      : [];
  return items
    .filter(
      (i): i is Csl =>
        !!i && typeof i === 'object' && typeof (i as Csl).title === 'string'
    )
    .map((item) => {
      const authors = (
        Array.isArray(item.author) ? item.author : (item.editor ?? [])
      ) as Csl[];
      const names = authors.map(family).filter(Boolean);
      const creators =
        names.length > 2 ? `${names[0]} et al.` : names.join(' and ');
      const issued = item.issued as
        { 'date-parts'?: unknown[][]; raw?: unknown } | undefined;
      const year =
        /\d{4}/.exec(
          String(issued?.['date-parts']?.[0]?.[0] ?? issued?.raw ?? '')
        )?.[0] ?? '';
      return { title: item.title as string, creators, year, csl: item };
    });
}

const SETTING =
  'Settings → Advanced → “Allow other applications on this computer to communicate with Zotero”';

/**
 * Zotero's server drops every request that looks like it came from a web
 * browser (a `Mozilla/` user agent or an `Origin` header) unless it carries
 * a connector header, and it sends CORS headers only for its own bookmarklet
 * origin, so a web page can't send that header either (zotero/zotero,
 * chrome/content/zotero/xpcom/server/server.js: `_processEndpoint` →
 * `_cancelResponse`, which closes the connection "so web content can't get
 * any information about whether Zotero is running"). Chrome's Local Network
 * Access check may stop the request first. Either way fetch() throws exactly
 * as if Zotero weren't running, so the message can't tell the cases apart.
 * Read in Zotero's main branch and seen with Zotero 11.0-beta.3 and Chrome
 * from the Pages site in November 2026 (ADR 0009).
 */
const LOCAL_UNREACHABLE = `Zotero on this computer can’t be reached from this site: Zotero drops requests from web browsers, so websites can’t read your library. Search your zotero.org web library instead, or export a .bib file from Zotero and import it. (Also check that Zotero is running with ${SETTING}.)`;

export async function searchZotero(
  source: ZoteroSource,
  query: string,
  { fetch }: { fetch: typeof globalThis.fetch }
): Promise<ZoteroSearch> {
  if (!query.trim())
    return { ok: false, message: 'Type something to search for.' };
  if (
    source.kind === 'web' &&
    (!/^\d+$/.test(source.userId.trim()) || !source.apiKey.trim())
  )
    return {
      ok: false,
      message:
        'Enter your Zotero user ID (a number, shown at zotero.org/settings/keys) and an API key with read access.',
    };
  const { url, headers } = zoteroSearchRequest(
    source.kind === 'web'
      ? {
          ...source,
          userId: source.userId.trim(),
          apiKey: source.apiKey.trim(),
        }
      : source,
    query.trim()
  );
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch {
    return {
      ok: false,
      message:
        source.kind === 'local'
          ? LOCAL_UNREACHABLE
          : 'Couldn’t reach api.zotero.org. Check your connection and try again.',
    };
  }
  if (!response.ok) {
    const s = response.status;
    if (source.kind === 'local' && s === 403)
      return {
        ok: false,
        message: `Zotero’s local API is turned off: ${SETTING}.`,
      };
    if (source.kind === 'local' && s === 404)
      return {
        ok: false,
        message: 'This Zotero has no local API: update to Zotero 7 or later.',
      };
    if (source.kind === 'web' && s === 403)
      return {
        ok: false,
        message:
          'Zotero refused the API key: check it is correct and allows reading this library.',
      };
    if (source.kind === 'web' && s === 404)
      return {
        ok: false,
        message: `No Zotero library for user ${source.userId.trim()}: check the user ID.`,
      };
    return { ok: false, message: `Zotero answered ${s}. Try again later.` };
  }
  try {
    return {
      ok: true,
      hits: parseZoteroItems(JSON.parse(await response.text())),
    };
  } catch {
    return { ok: false, message: 'The answer was not a Zotero search result.' };
  }
}
