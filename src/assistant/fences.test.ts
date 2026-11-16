import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFences } from './fences.ts';

describe('splitFences', () => {
  test('prose and fenced code alternate; the language tag is kept', () => {
    assert.deepEqual(splitFences('Try:\n```latex\n\\emph{x}\n```\nDone.'), [
      { kind: 'text', text: 'Try:\n' },
      { kind: 'code', lang: 'latex', text: '\\emph{x}' },
      { kind: 'text', text: '\nDone.' },
    ]);
  });

  test('an unclosed fence (still streaming) is code to the end', () => {
    assert.deepEqual(splitFences('A\n```\nx\ny'), [
      { kind: 'text', text: 'A\n' },
      { kind: 'code', lang: '', text: 'x\ny' },
    ]);
  });

  test('plain text is one segment; empty text none', () => {
    assert.deepEqual(splitFences('hi'), [{ kind: 'text', text: 'hi' }]);
    assert.deepEqual(splitFences(''), []);
  });
});
