/**
 * "Add reference": a DOI (or a URL/arXiv ID containing one) is looked up at
 * doi.org by content negotiation; any other URL becomes a @misc entry for
 * the user to complete. Only what the user typed is sent, never document
 * content (AGENTS.md §9). `fetch` is injected so this stays testable.
 */
import { cslToEntry } from './csl.ts';
import { citeKey } from './keys.ts';
import { parseReferenceInput } from './input.ts';
import { serializeEntry } from './serialize.ts';
import { formatToday } from '../render/typeset-text.ts';

export interface LookupOptions {
  fetch: typeof globalThis.fetch;
  today: Date;
  /** Keys already in the library; the new key avoids them. */
  taken: Set<string>;
}

export type LookupResult =
  | { ok: true; key: string; text: string; from: 'doi' | 'url' }
  | { ok: false; message: string };

const CSL = 'application/vnd.citationstyles.csl+json';

export async function lookupReference(
  input: string,
  { fetch, today, taken }: LookupOptions
): Promise<LookupResult> {
  const parsed = parseReferenceInput(input);
  if (parsed.kind === 'invalid')
    return {
      ok: false,
      message: 'Enter a DOI (10.…), a doi.org or arXiv link, or a web address.',
    };
  if (parsed.kind === 'url') return fromUrl(parsed.url, today, taken);

  const path = parsed.doi.split('/').map(encodeURIComponent).join('/');
  let response: Response;
  try {
    response = await fetch(`https://doi.org/${path}`, {
      headers: { Accept: CSL },
    });
  } catch {
    return {
      ok: false,
      message: 'Couldn’t reach doi.org. Check your connection and try again.',
    };
  }
  if (response.status === 404)
    return { ok: false, message: `doi.org has no record of ${parsed.doi}.` };
  if (!response.ok)
    return {
      ok: false,
      message: `doi.org answered ${response.status} for ${parsed.doi}.`,
    };
  let entry;
  try {
    entry = cslToEntry(JSON.parse(await response.text()));
  } catch {
    return {
      ok: false,
      message: `The answer for ${parsed.doi} is not a citation record.`,
    };
  }
  const fields = new Map(entry.fields.map((f) => [f.name, f.value]));
  const key = citeKey({ fields }, taken);
  return { ok: true, key, text: serializeEntry(key, entry), from: 'doi' };
}

function fromUrl(url: string, today: Date, taken: Set<string>): LookupResult {
  const { hostname, pathname } = new URL(url);
  const site = hostname.replace(/^www\./, '').split('.')[0];
  const words = decodeURIComponent(pathname).replace(/[^\p{L}\p{N}]+/gu, ' ');
  const key = citeKey(
    {
      fields: new Map([
        ['author', `{${site}}`],
        ['title', words],
        ['year', String(today.getFullYear())],
      ]),
    },
    taken
  );
  const text = serializeEntry(key, {
    type: 'misc',
    fields: [
      { name: 'url', value: url },
      { name: 'note', value: `Accessed ${formatToday(today)}` },
    ],
  });
  return { ok: true, key, text, from: 'url' };
}
