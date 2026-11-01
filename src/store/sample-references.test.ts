import { test } from 'node:test';
import assert from 'node:assert';
import { SAMPLE_REFERENCES } from './sample-references.ts';
import { parseBib } from '../latex/bibtex/bib-parser.ts';

test('the starter references parse cleanly with author_topic_year keys', () => {
  const { entries, warnings } = parseBib(SAMPLE_REFERENCES);
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(entries.length, 5);
  for (const e of entries) {
    assert.match(e.key, /^[a-z]+_[a-z]+_\d{4}$/);
    assert.strictEqual(e.key.split('_')[2], e.fields.get('year'));
  }
});
