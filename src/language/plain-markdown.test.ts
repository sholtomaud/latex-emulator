import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { plainMarkdown } from './plain-markdown.ts';

describe('plainMarkdown', () => {
  test('a comment shows as typed: links, HTML and emphasis are escaped', () => {
    assert.equal(
      plainMarkdown('[x](javascript:alert(1)) <img> *b* `c`'),
      '\\[x\\]\\(javascript:alert\\(1\\)\\) \\<img\\> \\*b\\* \\`c\\`'
    );
  });
  test('line breaks are kept', () => {
    assert.equal(plainMarkdown('a\nb'), 'a  \nb');
  });
});
