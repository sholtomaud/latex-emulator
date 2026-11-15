import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeBib, subsetBib } from './bib-subset.ts';
import { runBibtex } from '../latex/bibtex/bibtex.ts';
import { parseBib } from '../latex/bibtex/bib-parser.ts';

const LIBRARY = `% Exported library
@string{jgr = {Journal of Geophysical Research}}
@preamble{"\\newcommand{\\noop}[1]{}"}

@article{odum_1996,
  author = {Odum, Howard T.},
  title = {Environmental Accounting},
  journal = jgr,
  year = 1996
}

@book{unused_2001,
  author = {Nobody, A.},
  title = {Never Cited},
  publisher = {P},
  year = 2001
}

@inproceedings{child_2003,
  author = {Child, C.},
  title = {A Chapter},
  crossref = {parent_2003},
  pages = {1--10}
}

@proceedings{parent_2003,
  title = {The Proceedings},
  year = 2003,
  publisher = {Q}
}

@misc{Mixed_Case,
  author = {Case, M.},
  title = {Keys Match Without Case},
  year = 2010
}
`;

const keys = (bib: string) => parseBib(bib).entries.map((e) => e.key);

describe('subsetBib', () => {
  test('keeps only the cited entries, with @string and @preamble', () => {
    const out = subsetBib(LIBRARY, ['odum_1996']);
    assert.deepEqual(keys(out), ['odum_1996']);
    assert.match(out, /@string\{jgr/);
    assert.match(out, /@preamble/);
    assert.doesNotMatch(out, /Never Cited/);
    // The entry is copied exactly as written in the library.
    assert.ok(
      out.includes(
        LIBRARY.slice(LIBRARY.indexOf('@article'), LIBRARY.indexOf('@book') - 2)
      )
    );
  });

  test('keys match without case, as BibTeX matches them', () => {
    assert.deepEqual(keys(subsetBib(LIBRARY, ['mixed_case'])), ['Mixed_Case']);
  });

  test('a crossref parent comes along with its child', () => {
    assert.deepEqual(keys(subsetBib(LIBRARY, ['child_2003'])), [
      'child_2003',
      'parent_2003',
    ]);
  });

  test('\\nocite{*} keeps the whole file; nothing cited keeps no entries', () => {
    assert.equal(subsetBib(LIBRARY, ['*']), LIBRARY);
    assert.deepEqual(keys(subsetBib(LIBRARY, [])), []);
  });

  test('bibtex makes the same .bbl from the subset as from the whole library', () => {
    const cited = ['odum_1996', 'child_2003', 'MIXED_CASE'];
    for (const style of ['plainnat', 'unsrt', 'elsarticle-harv']) {
      const bst = fs.readFileSync(`src/assets/bst/${style}.bst`, 'utf8');
      const full = runBibtex({ bst, bib: LIBRARY, citations: cited });
      const part = runBibtex({
        bst,
        bib: subsetBib(LIBRARY, cited),
        citations: cited,
      });
      assert.equal(part.bbl, full.bbl, style);
    }
  });

  test('a file that does not parse is kept whole rather than cut wrongly', () => {
    const broken = '@article{a, title = {unclosed';
    assert.equal(subsetBib(broken, ['a']), broken);
  });
});

describe('mergeBib', () => {
  const folder = `@string{jgr = {Journal of Geophysical Research}}
@string{nat = {Nature}}

@article{odum_1996,
  author = {Odum, Howard T.},
  title = {Environmental Accounting},
  journal = jgr,
  year = 1996
}

@article{new_2020,
  author = {New, N.},
  title = {Only In The Folder},
  journal = nat,
  year = 2020
}

@misc{mixed_case,
  author = {Case, M.},
  title = {Edited In The Folder},
  year = 2010
}
`;

  test('adds entries the library lacks, with the @string they need; keeps the library’s copy of the others', () => {
    const r = mergeBib(LIBRARY, folder);
    assert.deepEqual(r.added, ['new_2020']);
    // Same key, different text: the library's wins, and it is reported.
    assert.deepEqual(r.differing, ['mixed_case']);
    const merged = parseBib(r.text);
    assert.deepEqual(
      merged.entries.map((e) => e.key),
      [
        'odum_1996',
        'unused_2001',
        'child_2003',
        'parent_2003',
        'Mixed_Case',
        'new_2020',
      ]
    );
    assert.equal(
      merged.entries.find((e) => e.key === 'new_2020')!.fields.get('journal'),
      'Nature'
    );
    assert.equal(
      merged.entries.find((e) => e.key === 'Mixed_Case')!.fields.get('title'),
      'Keys Match Without Case'
    );
  });

  test('nothing new leaves the library as it was', () => {
    const r = mergeBib(LIBRARY, subsetBib(LIBRARY, ['odum_1996']));
    assert.equal(r.text, LIBRARY);
    assert.deepEqual(r.added, []);
    assert.deepEqual(r.differing, []);
  });

  test('a folder file that does not parse adds nothing', () => {
    const r = mergeBib(LIBRARY, '@article{x, title = {unclosed');
    assert.equal(r.text, LIBRARY);
    assert.deepEqual(r.added, []);
  });
});
