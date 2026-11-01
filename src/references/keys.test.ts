import { describe, test } from 'node:test';
import assert from 'node:assert';
import { citeKey } from './keys.ts';

const entry = (fields: Record<string, string>) => ({
  fields: new Map(Object.entries(fields)),
});

describe('citeKey: author_topic_year', () => {
  test('first author’s family name, first significant title word, year', () => {
    assert.strictEqual(
      citeKey(
        entry({
          author: 'Odum, Howard T.',
          title: 'Environmental Accounting',
          year: '1996',
        })
      ),
      'odum_environmental_1996'
    );
    assert.strictEqual(
      citeKey(
        entry({
          author: 'Hall, Charles A. S. and Lambert, Jessica G.',
          title: '{EROI} of different fuels and the implications for society',
          year: '2014',
        })
      ),
      'hall_eroi_2014'
    );
  });

  test('skips leading stop words, in several languages', () => {
    assert.strictEqual(
      citeKey(
        entry({
          author: 'Knuth, Donald',
          title: 'The {\\TeX}book',
          year: '1984',
        })
      ),
      'knuth_texbook_1984'
    );
    assert.strictEqual(
      citeKey(entry({ author: 'X, Y', title: 'Über die Natur', year: '1900' })),
      'x_uber_1900'
    );
    assert.strictEqual(
      citeKey(
        entry({
          author: 'X, Y',
          title: 'On the origin of species',
          year: '1859',
        })
      ),
      'x_origin_1859'
    );
  });

  test('drops von particles and folds accents, LaTeX or Unicode', () => {
    assert.strictEqual(
      citeKey(
        entry({
          author: 'van der Waals, J. D.',
          title: 'Continuity',
          year: '1873',
        })
      ),
      'waals_continuity_1873'
    );
    assert.strictEqual(
      citeKey(
        entry({
          author: 'G{\\"o}del, Kurt',
          title: '{\\"U}ber formal',
          year: '1931',
        })
      ),
      'godel_uber_1931'
    );
    assert.strictEqual(
      citeKey(
        entry({
          author: 'Gödel, Kurt and Weiß, A.',
          title: 'Straße',
          year: '1931',
        })
      ),
      'godel_strasse_1931'
    );
  });

  test('falls back to editor, then to the title alone; year from date', () => {
    assert.strictEqual(
      citeKey(
        entry({
          editor: 'Smith, Jane',
          title: 'Proceedings',
          date: '2020-05-01',
        })
      ),
      'smith_proceedings_2020'
    );
    assert.strictEqual(
      citeKey(entry({ title: 'Anonymous pamphlet' })),
      'anonymous_pamphlet'
    );
    assert.strictEqual(
      citeKey(entry({ author: '{World Health Organization}', year: '2019' })),
      'worldhealthorganization_2019'
    );
    assert.strictEqual(citeKey(entry({})), 'ref');
  });

  test('collisions get a, b, c… (case-insensitively)', () => {
    const e = entry({ author: 'Odum, H.', title: 'Energy', year: '1996' });
    assert.strictEqual(
      citeKey(e, new Set(['Odum_Energy_1996'])),
      'odum_energy_1996a'
    );
    assert.strictEqual(
      citeKey(e, new Set(['odum_energy_1996', 'odum_energy_1996a'])),
      'odum_energy_1996b'
    );
    const many = new Set([
      'ref',
      ...[...'abcdefghijklmnopqrstuvwxyz'].map((s) => `ref${s}`),
    ]);
    assert.strictEqual(citeKey(entry({}), many), 'refaa');
  });
});
