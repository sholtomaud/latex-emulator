import { describe, test } from 'node:test';
import assert from 'node:assert';
import { tokenize } from './lexer.ts';
import type { Token } from './lexer.ts';

/** Compact view of tokens: [type, value] pairs. */
const view = (src: string) =>
  tokenize(src).map((t: Token) => [t.type, t.value]);

describe('tokenize', () => {
  test('control words, text and groups', () => {
    assert.deepStrictEqual(view('\\emph{Hi}'), [
      ['command', 'emph'],
      ['begin-group', '{'],
      ['text', 'Hi'],
      ['end-group', '}'],
    ]);
  });

  test('control symbols are a single non-letter character', () => {
    assert.deepStrictEqual(view('\\%\\\\\\ '), [
      ['command', '%'],
      ['command', '\\'],
      ['command', ' '],
    ]);
  });

  test('control words may contain @ and stop at non-letters', () => {
    assert.deepStrictEqual(view('\\make@title2'), [
      ['command', 'make@title'],
      ['text', '2'],
    ]);
  });

  test('a single newline is a space; a blank line is a paragraph break', () => {
    assert.deepStrictEqual(view('a\nb\n\n  \nc'), [
      ['text', 'a'],
      ['space', '\n'],
      ['text', 'b'],
      ['parbreak', '\n\n  \n'],
      ['text', 'c'],
    ]);
  });

  test('comments swallow their newline and the next line’s indentation', () => {
    assert.deepStrictEqual(view('a% note\n   b'), [
      ['text', 'a'],
      ['comment', '% note\n   '],
      ['text', 'b'],
    ]);
  });

  test('a blank line after a comment is still a paragraph break', () => {
    assert.deepStrictEqual(view('a%\n\nb'), [
      ['text', 'a'],
      ['comment', '%\n'],
      ['parbreak', '\n'],
      ['text', 'b'],
    ]);
  });

  test('math shifts are single $ tokens; the parser pairs $$', () => {
    assert.deepStrictEqual(view('$x$$$y'), [
      ['math-shift', '$'],
      ['text', 'x'],
      ['math-shift', '$'],
      ['math-shift', '$'],
      ['math-shift', '$'],
      ['text', 'y'],
    ]);
  });

  test('square brackets are single-character text tokens', () => {
    assert.deepStrictEqual(view('a[b]c'), [
      ['text', 'a'],
      ['text', '['],
      ['text', 'b'],
      ['text', ']'],
      ['text', 'c'],
    ]);
  });

  test('special characters', () => {
    assert.deepStrictEqual(view('a~b&c#^_'), [
      ['text', 'a'],
      ['special', '~'],
      ['text', 'b'],
      ['special', '&'],
      ['text', 'c'],
      ['special', '#'],
      ['special', '^'],
      ['special', '_'],
    ]);
  });

  test('\\verb captures raw text between delimiters', () => {
    const [tok] = tokenize('\\verb|\\x{}|');
    assert.strictEqual(tok.type, 'verb');
    assert.strictEqual(tok.value, '\\x{}');
    assert.strictEqual(tok.star, false);
    assert.deepStrictEqual(tok.range, { start: 0, end: 11 });
  });

  test('\\verb* is starred', () => {
    const [tok] = tokenize('\\verb*+a b+');
    assert.strictEqual(tok.type, 'verb');
    assert.strictEqual(tok.value, 'a b');
    assert.strictEqual(tok.star, true);
  });

  test('unterminated \\verb runs to end of line and is flagged', () => {
    const [tok, next] = tokenize('\\verb|abc\nd');
    assert.strictEqual(tok.type, 'verb');
    assert.strictEqual(tok.value, 'abc');
    assert.strictEqual(tok.unterminated, true);
    assert.strictEqual(next.type, 'space');
  });

  test('verbatim environments are captured raw', () => {
    const toks = tokenize('\\begin{verbatim}\n$x$ \\y\n\\end{verbatim}!');
    assert.strictEqual(toks[0].type, 'verbatim');
    assert.strictEqual(toks[0].value, '$x$ \\y\n');
    assert.strictEqual(toks[0].env, 'verbatim');
    assert.deepStrictEqual(view('\\begin{verbatim}a\\end{verbatim}!').at(-1), [
      'text',
      '!',
    ]);
  });

  test('unterminated verbatim runs to end of input and is flagged', () => {
    const [tok] = tokenize('\\begin{verbatim}abc');
    assert.strictEqual(tok.type, 'verbatim');
    assert.strictEqual(tok.value, 'abc');
    assert.strictEqual(tok.unterminated, true);
  });

  test('ranges are UTF-16 offsets that cover the input', () => {
    const src = 'é \\a{b}%c\n$d$';
    const toks = tokenize(src);
    assert.strictEqual(toks[0].range.start, 0);
    for (let i = 1; i < toks.length; i++)
      assert.strictEqual(toks[i].range.start, toks[i - 1].range.end);
    assert.strictEqual(toks.at(-1)!.range.end, src.length);
    for (const t of toks)
      assert.strictEqual(src.slice(t.range.start, t.range.end), t.raw);
  });

  test('a trailing lone backslash is a command with an empty name', () => {
    assert.deepStrictEqual(view('a\\'), [
      ['text', 'a'],
      ['command', ''],
    ]);
  });
});
