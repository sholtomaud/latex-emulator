import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { lookupReference } from './lookup.ts';

const brown = fs.readFileSync(
  new URL('../../fixtures/references/brown-2004.csl.json', import.meta.url),
  'utf8'
);
const today = new Date(2026, 10, 1);

/** A fetch that records requests and answers with `respond`. */
function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; accept: string | null }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, accept: new Headers(init?.headers).get('accept') });
    return respond(url);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe('lookupReference', () => {
  test('a DOI is fetched from doi.org as CSL-JSON and becomes a keyed entry', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(brown, { status: 200 })
    );
    const r = await lookupReference(
      'https://doi.org/10.1016/j.ecolmodel.2003.12.032',
      {
        fetch,
        today,
        taken: new Set(['brown_energy_2004']),
      }
    );
    assert.deepStrictEqual(calls, [
      {
        url: 'https://doi.org/10.1016/j.ecolmodel.2003.12.032',
        accept: 'application/vnd.citationstyles.csl+json',
      },
    ]);
    assert.ok(r.ok);
    assert.strictEqual(r.key, 'brown_energy_2004a');
    assert.strictEqual(r.from, 'doi');
    assert.match(
      r.text,
      /^@article\{brown_energy_2004a,\n {2}author = \{Brown, Mark T\. and Ulgiati, Sergio\},/
    );
  });

  test('DOI characters are percent-encoded in the request', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response('{"type":"book","title":"T"}')
    );
    await lookupReference(
      '10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0',
      {
        fetch,
        today,
        taken: new Set(),
      }
    );
    assert.strictEqual(
      calls[0].url,
      'https://doi.org/10.1002/(SICI)1097-4571(199806)49%3A8%3C693%3A%3AAID-ASI4%3E3.0.CO%3B2-0'
    );
  });

  test('a URL without a DOI becomes a @misc entry to complete', async () => {
    const { fetch, calls } = fakeFetch(() => {
      throw new Error('no request expected');
    });
    const r = await lookupReference(
      'https://www.example.org/reports/eroi-2024',
      {
        fetch,
        today,
        taken: new Set(),
      }
    );
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(r, {
      ok: true,
      from: 'url',
      key: 'example_reports_2026',
      text: '@misc{example_reports_2026,\n  url = {https://www.example.org/reports/eroi-2024},\n  note = {Accessed November 1, 2026},\n}\n',
    });
  });

  test('failures are explained', async () => {
    const opts = (respond: () => Response | Promise<Response>) => ({
      fetch: fakeFetch(respond).fetch,
      today,
      taken: new Set<string>(),
    });
    const message = async (
      input: string,
      respond: () => Response | Promise<Response>
    ) => {
      const r = await lookupReference(input, opts(respond));
      assert.ok(!r.ok);
      return r.message;
    };
    assert.match(
      await message('nothing useful', () => new Response('')),
      /Enter a DOI/
    );
    assert.match(
      await message(
        '10.1234/missing',
        () => new Response('not found', { status: 404 })
      ),
      /doi\.org has no record of 10\.1234\/missing/
    );
    assert.match(
      await message('10.1234/x', () => new Response('oops', { status: 500 })),
      /doi\.org answered 500/
    );
    assert.match(
      await message('10.1234/x', () =>
        Promise.reject(new TypeError('Failed to fetch'))
      ),
      /Couldn’t reach doi\.org/
    );
    assert.match(
      await message('10.1234/x', () => new Response('<html>', { status: 200 })),
      /not a citation record/
    );
  });
});
