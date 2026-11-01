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
  const params = new URLSearchParams({
    format: 'csljson',
    limit: String(limit),
    q: query,
  });
  const base =
    source.kind === 'local'
      ? `${LOCAL_API}/users/0` // the local API's name for "my library"
      : `${WEB_API}/users/${encodeURIComponent(source.userId)}`;
  const headers: Record<string, string> = { 'Zotero-API-Version': '3' };
  if (source.kind === 'web') headers['Zotero-API-Key'] = source.apiKey;
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
          ? `Zotero isn’t answering on this computer. Start Zotero 7 and turn on ${SETTING}. If your browser asks whether this site may reach devices on your local network, allow it.`
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
