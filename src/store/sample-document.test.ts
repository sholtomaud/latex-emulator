import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { SAMPLE_DOCUMENT } from './sample-document.ts';

test('the starter document is the article-basic fixture', () => {
  const fixture = fs.readFileSync(
    new URL('../../fixtures/article-basic/input.tex', import.meta.url),
    'utf8'
  );
  assert.strictEqual(SAMPLE_DOCUMENT, fixture);
});
