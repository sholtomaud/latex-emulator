import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parse } from '../parser/parser.ts';
import { toLatex } from '../ast/to-latex.ts';
import type { EnvironmentNode } from '../ast/nodes.ts';
import { algorithmicLines } from './lines.ts';
import type { AlgLine } from './lines.ts';

function build(body: string, opt = '', options = {}) {
  const env = parse(
    `\\begin{algorithmic}${opt}\n${body}\n\\end{algorithmic}`
  ).root.children.find((n): n is EnvironmentNode => n.kind === 'environment')!;
  return algorithmicLines(env, options);
}

/** One line per AlgLine: label, two spaces per depth, then the content. */
function show(lines: AlgLine[]): string[] {
  return lines.map((l) => {
    const label =
      l.label === 'require'
        ? 'Require:'
        : l.label === 'ensure'
          ? 'Ensure:'
          : l.number === null
            ? '.'
            : `${l.number}:`;
    const parts = l.parts
      .map((p) =>
        p.kind === 'keyword'
          ? `**${p.text}**`
          : p.kind === 'text'
            ? p.text
            : p.kind === 'proc'
              ? `SC(${toLatex(p.nodes)})`
              : toLatex(p.nodes)
      )
      .join('')
      .trim();
    const comment = l.comment === null ? '' : ` |> ${toLatex(l.comment)}`;
    return `${label} ${'  '.repeat(l.depth)}${parts}${comment}`.trimEnd();
  });
}

describe('algorithmicLines: what each line prints (algpseudocode.sty)', () => {
  test('blocks open and close with bold keywords, nesting by depth', () => {
    const { lines, problems } = build(
      [
        '\\Procedure{Euclid}{$a, b$}',
        '\\State $r \\gets a$',
        '\\While{$r \\ne 0$}',
        '\\State $a \\gets b$',
        '\\EndWhile',
        '\\EndProcedure',
      ].join('\n')
    );
    assert.deepStrictEqual(problems, []);
    assert.deepStrictEqual(show(lines), [
      '. **procedure** SC(Euclid)($a, b$)',
      '.   $r \\gets a$',
      '.   **while** $r \\ne 0$ **do**',
      '.     $a \\gets b$',
      '.   **end** **while**',
      '. **end** **procedure**',
    ]);
  });

  test('if, else if, else; for, for all; repeat … until; loop; function', () => {
    const { lines, problems } = build(
      [
        '\\Function{F}{}',
        '\\If{$p$}\\State a',
        '\\ElsIf{$q$}\\State b',
        '\\Else\\State c',
        '\\EndIf',
        '\\For{$i$}\\EndFor',
        '\\ForAll{$y$}\\EndFor',
        '\\Repeat\\State d',
        '\\Until{$s < 1$}',
        '\\Loop\\EndLoop',
        '\\EndFunction',
      ].join('\n')
    );
    assert.deepStrictEqual(problems, []);
    assert.deepStrictEqual(show(lines), [
      // \Function{F}{}: no parentheses for empty arguments.
      '. **function** SC(F)',
      '.   **if** $p$ **then**',
      '.     a',
      '.   **else** **if** $q$ **then**',
      '.     b',
      '.   **else**',
      '.     c',
      '.   **end** **if**',
      '.   **for** $i$ **do**',
      '.   **end** **for**',
      '.   **for all** $y$ **do**',
      '.   **end** **for**',
      '.   **repeat**',
      '.     d',
      '.   **until** $s < 1$',
      '.   **loop**',
      '.   **end** **loop**',
      '. **end** **function**',
    ]);
  });

  test('\\Require and \\Ensure hang a label; \\Statex is an empty line', () => {
    const { lines } = build(
      '\\Require $n \\ge 0$\n\\Ensure $y = n!$\n\\State x\n\\Statex\n\\State y',
      '[1]'
    );
    assert.deepStrictEqual(show(lines), [
      'Require: $n \\ge 0$',
      'Ensure: $y = n!$',
      '1: x',
      '.',
      '2: y',
    ]);
  });

  test('\\Comment is \\hfill ▷ text: what follows it on the line joins it', () => {
    const { lines } = build(
      '\\While{$r$}\\Comment{loop}\n\\State x \\Comment{set} more\n\\EndWhile'
    );
    assert.deepStrictEqual(show(lines), [
      '. **while** $r$ **do** |> loop',
      '.   x |> set more',
      '. **end** **while**',
    ]);
  });

  test('comments and white space between lines are not content', () => {
    const { lines } = build('% a comment\n\\State x % trailing\n\n\\State y');
    assert.deepStrictEqual(show(lines), ['. x', '. y']);
  });
});

describe('algorithmicLines: numbering (\\ALG@step)', () => {
  const body = Array.from({ length: 5 }, (_, i) => `\\State s${i + 1}`).join(
    '\n'
  );

  test('no [n], or [0]: no numbers', () => {
    assert.ok(build(body).lines.every((l) => l.number === null));
    assert.ok(build(body, '[0]').lines.every((l) => l.number === null));
  });

  test('[1] numbers every line, [2] every second; all lines count', () => {
    assert.deepStrictEqual(
      build(body, '[1]').lines.map((l) => l.number),
      [1, 2, 3, 4, 5]
    );
    assert.deepStrictEqual(
      build(body, '[2]').lines.map((l) => l.number),
      [null, 2, null, 4, null]
    );
    assert.deepStrictEqual(
      build(body, '[2]').lines.map((l) => l.line),
      [1, 2, 3, 4, 5]
    );
  });

  test('block lines are numbered; \\Require, \\Ensure and \\Statex are not', () => {
    const { lines } = build(
      '\\Require r\n\\If{c}\n\\Statex\n\\State s\n\\EndIf',
      '[1]'
    );
    assert.deepStrictEqual(
      lines.map((l) => l.number),
      [null, 1, null, 2, 3]
    );
  });
});

describe('algorithmicLines: the noend option', () => {
  test('drops the closing lines; they are not numbered', () => {
    const { lines } = build(
      '\\While{c}\n\\State s\n\\EndWhile\n\\State t',
      '[1]',
      { noend: true }
    );
    assert.deepStrictEqual(show(lines), [
      '1: **while** c **do**',
      '2:   s',
      '3: t',
    ]);
  });
});

describe('algorithmicLines: unbalanced blocks', () => {
  test('an end with nothing open is reported and printed at depth 0', () => {
    const { lines, problems } = build('\\State x\n\\EndWhile');
    assert.deepStrictEqual(show(lines), ['. x', '. **end** **while**']);
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0].message, /\\EndWhile has no \\While to close/);
  });

  test('the wrong end closes the block it names, reporting the inner one', () => {
    const src = '\\For{i}\n\\If{c}\n\\State x\n\\EndFor';
    const { lines, problems } = build(src);
    assert.deepStrictEqual(show(lines), [
      '. **for** i **do**',
      '.   **if** c **then**',
      '.     x',
      '. **end** **for**',
    ]);
    assert.deepStrictEqual(
      problems.map((p) => p.message),
      ['\\If is not closed: add \\EndIf.']
    );
  });

  test('\\Else and \\ElsIf need an \\If; nothing may follow \\Else but \\EndIf', () => {
    assert.match(
      build('\\Else').problems[0]?.message ?? '',
      /\\Else has no \\If/
    );
    assert.match(
      build('\\If{a}\\Else\\ElsIf{b}\\EndIf').problems[0]?.message ?? '',
      /\\ElsIf has no \\If/
    );
  });

  test('blocks still open at \\end{algorithmic} are reported where they open', () => {
    const src = '\\While{c}\n\\State x';
    const { problems } = build(src);
    assert.deepStrictEqual(
      problems.map((p) => p.message),
      ['\\While is not closed: add \\EndWhile.']
    );
    const start = `\\begin{algorithmic}\n`.length;
    assert.deepStrictEqual(problems[0].range, {
      start,
      end: start + '\\While{c}'.length,
    });
  });

  test('text before the first \\State is reported and kept', () => {
    const { lines, problems } = build('stray text\n\\State x');
    assert.deepStrictEqual(show(lines), ['. stray text', '. x']);
    assert.match(problems[0].message, /before the first \\State/);
  });
});
