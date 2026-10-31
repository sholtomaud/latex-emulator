import { describe, test } from 'node:test';
import assert from 'node:assert';
import { applyAccent, formatToday, typesetText } from './typeset-text.ts';

describe('typesetText (TeX ligatures in text fonts)', () => {
  test('quotes', () => {
    assert.strictEqual(
      typesetText("``double'' and `single'"),
      '“double” and ‘single’'
    );
  });

  test('dashes', () => {
    assert.strictEqual(typesetText('1--10, a---b, x-y'), '1–10, a—b, x-y');
  });

  test('Spanish punctuation ligatures', () => {
    assert.strictEqual(typesetText('?`Qué? !`Ay!'), '¿Qué? ¡Ay!');
  });

  test('typewriter text keeps characters as typed', () => {
    assert.strictEqual(
      typesetText("``a'' -- b", { typewriter: true }),
      "``a'' -- b"
    );
  });
});

describe('applyAccent', () => {
  test('composes common accents', () => {
    assert.strictEqual(applyAccent("'", 'e'), 'é');
    assert.strictEqual(applyAccent('"', 'o'), 'ö');
    assert.strictEqual(applyAccent('c', 'c'), 'ç');
    assert.strictEqual(applyAccent('v', 's'), 'š');
    assert.strictEqual(applyAccent('^', 'a'), 'â');
  });

  test('dotless i and j take accents', () => {
    assert.strictEqual(applyAccent("'", 'ı'), 'í');
  });

  test('an empty argument gives the accent on its own', () => {
    assert.strictEqual(applyAccent('`', ''), '`');
  });

  test('accents without a precomposed form stay as combining sequences', () => {
    assert.strictEqual(applyAccent('H', 'x'), 'x̋');
  });

  test('unknown accent commands return the text unchanged', () => {
    assert.strictEqual(applyAccent('zz', 'a'), 'a');
  });
});

describe('formatToday', () => {
  test('matches LaTeX’s default \\today format', () => {
    assert.strictEqual(formatToday(new Date(2026, 9, 31)), 'October 31, 2026');
    assert.strictEqual(formatToday(new Date(2026, 0, 5)), 'January 5, 2026');
  });
});
