import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoteroTypeahead } from './zotero-typeahead.ts';
import type { ZoteroSearch, ZoteroSource } from './zotero.ts';

const LOCAL: ZoteroSource = { kind: 'local' };
const HIT = {
  key: 'Z1',
  title: 'Systems ecology',
  creators: 'Odum',
  year: '1983',
  csl: {
    type: 'book',
    title: 'Systems ecology',
    author: [{ family: 'Odum', given: 'Howard T.' }],
    issued: { 'date-parts': [[1983]] },
  },
};

/** A typeahead whose searches return `answer`, recording what it asked. */
function setup(answer: (q: string) => ZoteroSearch) {
  const asked: string[] = [];
  const reported: string[] = [];
  const typeahead = createZoteroTypeahead({
    search: async (_source, q) => {
      asked.push(q);
      return answer(q);
    },
    keys: () => new Set(),
    onFailure: (message) => reported.push(message),
  });
  return { typeahead, asked, reported };
}

describe('Zotero typeahead', () => {
  test('searches 3+ characters, once per prefix', async () => {
    const { typeahead, asked } = setup(() => ({ ok: true, hits: [HIT] }));
    assert.deepEqual(await typeahead.suggest(LOCAL, 'sy'), []);
    const s = await typeahead.suggest(LOCAL, 'sys');
    assert.equal(s[0].key, 'odum_systems_1983');
    await typeahead.suggest(LOCAL, 'SYS ');
    assert.deepEqual(asked, ['sys']);
  });

  test('after a failed search it stops asking, and says why once', async () => {
    // From a website, Chrome blocks localhost and Zotero drops browser
    // requests (ADR 0009): every prefix used to send a doomed request.
    const { typeahead, asked, reported } = setup(() => ({
      ok: false,
      message: 'Zotero on this computer can’t be reached from this site.',
    }));
    assert.deepEqual(await typeahead.suggest(LOCAL, 'odu'), []);
    assert.deepEqual(await typeahead.suggest(LOCAL, 'odum'), []);
    assert.deepEqual(await typeahead.suggest(LOCAL, 'cos'), []);
    assert.deepEqual(asked, ['odu']);
    assert.deepEqual(reported, [
      'Zotero suggestions are paused: Zotero on this computer can’t be reached from this site.',
    ]);
  });

  test('changed settings try again', async () => {
    let ok = false;
    const { typeahead, asked } = setup(() =>
      ok ? { ok: true, hits: [HIT] } : { ok: false, message: 'No.' }
    );
    await typeahead.suggest(LOCAL, 'odu');
    ok = true;
    typeahead.reset();
    assert.equal((await typeahead.suggest(LOCAL, 'odu')).length, 1);
    assert.deepEqual(asked, ['odu', 'odu']);
  });

  test('a new library entry is not suggested again under its old key', async () => {
    let taken = new Set<string>();
    const typeahead = createZoteroTypeahead({
      search: async () => ({ ok: true, hits: [HIT] }),
      keys: () => taken,
      onFailure: () => {},
    });
    assert.equal(
      (await typeahead.suggest(LOCAL, 'sys'))[0].key,
      'odum_systems_1983'
    );
    taken = new Set(['odum_systems_1983']);
    typeahead.reset();
    assert.equal(
      (await typeahead.suggest(LOCAL, 'sys'))[0].key,
      'odum_systems_1983a'
    );
  });
});
