import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { runBibtex } from './bibtex.ts';

const fixture = (p: string) =>
  fs.readFileSync(
    new URL(`../../../fixtures/bibtex/${p}`, import.meta.url),
    'utf8'
  );
const bib = fixture('test.bib');

/** Line-by-line diff that names the first difference, for readable failures. */
function assertSameBbl(actual: string, expected: string) {
  const a = actual.split('\n');
  const e = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, e.length); i++)
    assert.strictEqual(a[i], e[i], `line ${i + 1} differs`);
}

describe('runBibtex matches real bibtex (fixtures/bibtex/expected)', () => {
  for (const style of ['plainnat', 'plain', 'unsrt']) {
    test(`${style}.bst`, () => {
      const { bbl } = runBibtex({
        bst: fixture(`styles/${style}.bst`),
        bib,
        citations: ['*'],
      });
      assertSameBbl(bbl, fixture(`expected/${style}.bbl`));
    });
  }

  test('probe.bst: format.name$, change.case$, purify$, text.prefix$, substring$ …', () => {
    const { bbl } = runBibtex({
      bst: fixture('probe.bst'),
      bib,
      citations: ['*'],
    });
    assertSameBbl(bbl, fixture('expected/probe.bbl'));
  });
});

describe('runBibtex: citations', () => {
  const bst = fixture('styles/plainnat.bst');

  test('only cited entries are included, in sorted order for plainnat', () => {
    const { bbl } = runBibtex({
      bst,
      bib,
      citations: ['odum_energy_1996', 'brown_emergy_2004'],
    });
    const keys = [...bbl.matchAll(/\\bibitem\[[^\]]*\]\{([^}]*)\}/g)].map(
      (m) => m[1]
    );
    assert.deepStrictEqual(keys, ['brown_emergy_2004', 'odum_energy_1996']);
  });

  test('citation keys match case-insensitively and keep their .bib spelling', () => {
    const { bbl } = runBibtex({ bst, bib, citations: ['ODUM_ENERGY_1996'] });
    assert.match(bbl, /\\bibitem\[Odum\(1996\)\]\{odum_energy_1996\}/);
  });

  test('unknown citations are reported, not fatal', () => {
    const { bbl, warnings } = runBibtex({ bst, bib, citations: ['nokey'] });
    assert.match(bbl, /\\begin\{thebibliography\}\{0\}/);
    assert.ok(warnings.some((w) => w.includes('nokey')));
  });

  test('a parent cited through crossref is pulled in when cited twice', () => {
    const { bbl } = runBibtex({
      bst,
      bib,
      citations: ['crossref_paper_2014', 'hall_energy_2014'],
    });
    assert.match(bbl, /\{crossref_paper_2014\}/);
  });
});
