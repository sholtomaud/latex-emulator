import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  documentBody,
  stripComments,
  toPlainParagraphs,
} from './plain-text.ts';

describe('stripComments', () => {
  test('removes text after %', () => {
    assert.strictEqual(stripComments('text % comment'), 'text ');
  });

  test('keeps escaped \\%', () => {
    assert.strictEqual(stripComments('50\\% off % note'), '50\\% off ');
  });

  test('handles an escaped backslash before %', () => {
    assert.strictEqual(stripComments('a\\\\% b'), 'a\\\\');
  });
});

describe('documentBody', () => {
  test('returns the body between begin/end document', () => {
    const src =
      '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}';
    assert.strictEqual(documentBody(src).trim(), 'Hi');
  });

  test('returns the whole source when there is no document environment', () => {
    assert.strictEqual(documentBody('Just text'), 'Just text');
  });

  test('tolerates a missing \\end{document}', () => {
    assert.strictEqual(documentBody('\\begin{document}\nHi').trim(), 'Hi');
  });
});

describe('toPlainParagraphs', () => {
  test('splits on blank lines and collapses whitespace', () => {
    const src = 'One\n  line.\n\n\nTwo   lines\nhere.';
    assert.deepStrictEqual(toPlainParagraphs(src), [
      'One line.',
      'Two lines here.',
    ]);
  });

  test('a comment-only line does not end a paragraph', () => {
    assert.deepStrictEqual(toPlainParagraphs('a\n% note\nb'), ['a b']);
  });

  test('ignores the preamble', () => {
    const src = '\\title{X}\n\\begin{document}\nBody\n\\end{document}\nAfter';
    assert.deepStrictEqual(toPlainParagraphs(src), ['Body']);
  });

  test('returns nothing for an empty body', () => {
    assert.deepStrictEqual(
      toPlainParagraphs('\\begin{document}\n\n\\end{document}'),
      []
    );
  });
});
