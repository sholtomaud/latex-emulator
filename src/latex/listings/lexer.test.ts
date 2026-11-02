import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lstLines } from './lexer.ts';
import { LANGUAGES } from './languages.ts';

const opts = { tabsize: 8, showstringspaces: true };
/** Compact view: text/style per token, one array per line. */
const view = (code: string, lang = 'python', o = opts) =>
  lstLines(code, LANGUAGES[lang] ?? null, o).map((line) =>
    line.map((t) =>
      t.kind === 'space'
        ? `␠${t.text.length}`
        : `${t.text}:${t.style}${t.keywordClass && t.keywordClass > 1 ? t.keywordClass : ''}`
    )
  );

describe('lstLines (listings’ tokens)', () => {
  test('letters (with digits) and others are separate runs; spaces count columns', () => {
    assert.deepEqual(view('x1 = f(x)+10', ''), [
      [
        'x1:identifier',
        '␠1',
        '=:plain',
        '␠1',
        'f:identifier',
        '(:plain',
        'x:identifier',
        ')+10:plain',
      ],
    ]);
  });

  test('keywords by class; case sensitivity follows the language', () => {
    assert.deepEqual(view('for i in range(3): print'), [
      [
        'for:keyword',
        '␠1',
        'i:identifier',
        '␠1',
        'in:keyword',
        '␠1',
        'range:keyword2',
        '(3)::plain',
        '␠1',
        'print:keyword',
      ],
    ]);
    assert.deepEqual(view('FOR x', 'python')[0][0], 'FOR:identifier');
    assert.deepEqual(view('SELECT a', 'sql')[0][0], 'SELECT:keyword');
    assert.deepEqual(view('select a', 'sql')[0][0], 'select:keyword');
  });

  test('line comments run to the end of the line; block comments span lines', () => {
    assert.deepEqual(view('x # add one'), [
      [
        'x:identifier',
        '␠1',
        '#:comment',
        '␠1',
        'add:comment',
        '␠1',
        'one:comment',
      ],
    ]);
    assert.deepEqual(view('a /* b\nc */ d', '[ansi]c'), [
      ['a:identifier', '␠1', '/*:comment', '␠1', 'b:comment'],
      ['c:comment', '␠1', '*/:comment', '␠1', 'd:identifier'],
    ]);
    // Longest delimiter first: Python's """ docstring, not an empty string.
    assert.deepEqual(view('"""doc"""'), [
      ['""":comment', 'doc:comment', '""":comment'],
    ]);
  });

  test('strings: backslash or doubled escapes; spaces shown visible by default', () => {
    // Inside strings, runs still split by character class (as listings).
    assert.deepEqual(view('"a\\" b"'), [
      // A visible space is an "other" character (U+2423 marks it).
      ['":string', 'a:string', '\\"\u2423:string', 'b:string', '":string'],
    ]);
    assert.deepEqual(view("'it''s' x", 'sql'), [
      [
        "':string",
        'it:string',
        "'':string",
        's:string',
        "':string",
        '␠1',
        'x:identifier',
      ],
    ]);
    assert.deepEqual(
      view('"a b"', 'python', { tabsize: 8, showstringspaces: false }),
      [['":string', 'a:string', '␠1', 'b:string', '":string']]
    );
    // A [b] string ends at the end of its line.
    assert.deepEqual(view('"open\nx'), [
      ['":string', 'open:string'],
      ['x:identifier'],
    ]);
  });

  test('Matlab: a quote after a name or ) is a transpose, not a string', () => {
    assert.deepEqual(view("y = x' + 'a'", 'matlab'), [
      [
        'y:identifier',
        '␠1',
        '=:plain',
        '␠1',
        'x:identifier',
        "':plain",
        '␠1',
        '+:plain',
        '␠1',
        "':string",
        'a:string',
        "':string",
      ],
    ]);
  });

  test('C directives; TeX control sequences', () => {
    assert.deepEqual(view('#include <x.h>', '[ansi]c')[0].slice(0, 3), [
      '#:directive',
      'include:directive',
      '␠1',
    ]);
    // Only at the start of a line.
    assert.deepEqual(view('x #include', '[ansi]c')[0].slice(2), [
      '#:plain',
      'include:identifier',
    ]);
    assert.deepEqual(view('\\begin{x} \\foo % c', '[latex]tex'), [
      [
        '\\begin:texcs',
        '{:plain',
        'x:identifier',
        '}:plain',
        '␠1',
        '\\foo:identifier',
        '␠1',
        '%:comment',
        '␠1',
        'c:comment',
      ],
    ]);
  });

  test('tabs go to the next tab stop; a final newline makes no extra line', () => {
    assert.deepEqual(
      view('a\tb\n\tc\n', '', { tabsize: 4, showstringspaces: true }),
      [
        ['a:identifier', '␠3', 'b:identifier'],
        ['␠4', 'c:identifier'],
      ]
    );
    assert.deepEqual(view('a\n\nb', ''), [
      ['a:identifier'],
      [],
      ['b:identifier'],
    ]);
  });
});
