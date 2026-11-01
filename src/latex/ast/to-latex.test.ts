import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parse } from '../parser/parser.ts';
import { keyText, toLatex } from './to-latex.ts';

const roundTrip = (src: string) => toLatex(parse(src).root.children);

describe('toLatex', () => {
  test('round-trips text, groups, commands, arguments and math', () => {
    for (const src of [
      'Hall et~al.(2014)Hall, Lambert, and Balogh',
      '1955{\\natexlab{a}}',
      '\\emph{x} and \\section*[s]{T}',
      '$a^2$ \\(b\\) \\[c\\] $$d$$',
      '\\begin{center}x\\end{center}',
      '\\verb|v| \\begin{verbatim}raw\\end{verbatim}',
    ])
      assert.strictEqual(roundTrip(src), src);
  });

  test('keeps a control word apart from a following letter', () => {
    assert.strictEqual(roundTrip('\\LaTeX is'), '\\LaTeX is');
    assert.strictEqual(roundTrip('\\LaTeX,'), '\\LaTeX,');
  });

  test('drops comments; paragraph breaks survive', () => {
    assert.strictEqual(roundTrip('a%c\nb\n\nc'), 'ab\n\nc');
  });
});

describe('keyText', () => {
  test('gives the literal key text', () => {
    const [cite] = parse('\\cite{odum_energy_1996, b#2}').root.children;
    assert.ok(cite.kind === 'command');
    assert.strictEqual(keyText(cite.args[0].children), 'odum_energy_1996, b#2');
  });

  test('flattens groups and commands', () => {
    assert.strictEqual(keyText(parse('{a}\\x\n\ny').root.children), 'a\\x y');
  });
});
