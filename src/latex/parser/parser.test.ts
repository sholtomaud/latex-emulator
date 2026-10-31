import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parse } from './parser.ts';
import type {
  CommandNode,
  EnvironmentNode,
  GroupNode,
  MathNode,
  Node,
} from '../ast/nodes.ts';

/** Strip ranges for readable structural assertions. */
function shape(nodes: Node[]): unknown[] {
  return nodes.map((n) => {
    switch (n.kind) {
      case 'text':
        return n.value;
      case 'space':
        return ' ';
      case 'parbreak':
        return '¶';
      case 'comment':
        return { comment: n.value };
      case 'special':
        return { special: n.char };
      case 'verb':
        return { verb: n.value };
      case 'verbatim':
        return { verbatim: n.value };
      case 'group':
        return { group: shape(n.children) };
      case 'command':
        return {
          cmd: n.name + (n.star ? '*' : ''),
          args: n.args.map((a) =>
            a.optional ? { opt: shape(a.children) } : shape(a.children)
          ),
        };
      case 'environment':
        return {
          env: n.name,
          args: n.args.map((a) =>
            a.optional ? { opt: shape(a.children) } : shape(a.children)
          ),
          body: shape(n.children),
        };
      case 'math':
        return {
          math: n.display ? 'display' : 'inline',
          body: shape(n.children),
        };
    }
  });
}

const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);

describe('parse: commands and arguments', () => {
  test('text, spaces and a command with a braced argument', () => {
    assert.deepStrictEqual(shape(parse('Say \\emph{hi} now').root.children), [
      'Say',
      ' ',
      { cmd: 'emph', args: [['hi']] },
      ' ',
      'now',
    ]);
  });

  test('star, optional and mandatory arguments from the registry', () => {
    assert.deepStrictEqual(
      shape(parse('\\section*[Short]{Long title}').root.children),
      [{ cmd: 'section*', args: [{ opt: ['Short'] }, ['Long', ' ', 'title']] }]
    );
  });

  test('optional arguments are only taken when present', () => {
    assert.deepStrictEqual(shape(parse('\\section{A}').root.children), [
      { cmd: 'section', args: [['A']] },
    ]);
  });

  test('an unbraced mandatory argument takes one character (TeX semantics)', () => {
    assert.deepStrictEqual(shape(parse("\\'ecole").root.children), [
      { cmd: "'", args: [['e']] },
      'cole',
    ]);
  });

  test('an unbraced mandatory argument may be a command', () => {
    assert.deepStrictEqual(shape(parse('\\emph\\LaTeX').root.children), [
      { cmd: 'emph', args: [[{ cmd: 'LaTeX', args: [] }]] },
    ]);
  });

  test('a mandatory argument skips spaces before it', () => {
    assert.deepStrictEqual(shape(parse('\\textbf {x}').root.children), [
      { cmd: 'textbf', args: [['x']] },
    ]);
  });

  test('spaces after a control word are skipped, after a control symbol kept', () => {
    assert.deepStrictEqual(shape(parse('\\LaTeX is \\% x').root.children), [
      { cmd: 'LaTeX', args: [] },
      'is',
      ' ',
      { cmd: '%', args: [] },
      ' ',
      'x',
    ]);
  });

  test('a missing mandatory argument is an error', () => {
    assert.deepStrictEqual(codes('\\emph'), ['syntax/missing-argument']);
  });

  test('unknown commands warn and keep directly attached braced arguments', () => {
    const { root, diagnostics } = parse('\\foo[a]{b}{c} d');
    assert.deepStrictEqual(shape(root.children), [
      { cmd: 'foo', args: [{ opt: ['a'] }, ['b'], ['c']] },
      ' ',
      'd',
    ]);
    assert.strictEqual(diagnostics[0].code, 'syntax/unknown-command');
    assert.strictEqual(diagnostics[0].severity, 'warning');
    assert.deepStrictEqual(diagnostics[0].range, { start: 0, end: 4 });
  });
});

describe('parse: groups', () => {
  test('nested groups', () => {
    assert.deepStrictEqual(shape(parse('{a{b}}').root.children), [
      { group: ['a', { group: ['b'] }] },
    ]);
  });

  test('an unclosed group is an error at its opening brace and keeps content', () => {
    const { root, diagnostics } = parse('{a b');
    assert.deepStrictEqual(shape(root.children), [{ group: ['a', ' ', 'b'] }]);
    assert.strictEqual(diagnostics[0].code, 'syntax/unclosed-group');
    assert.deepStrictEqual(diagnostics[0].range, { start: 0, end: 1 });
  });

  test('a stray closing brace is an error and is dropped', () => {
    const { root, diagnostics } = parse('a}b');
    assert.deepStrictEqual(shape(root.children), ['a', 'b']);
    assert.strictEqual(diagnostics[0].code, 'syntax/unexpected-close-brace');
  });

  test('group ranges cover both braces', () => {
    const [g] = parse('{ab}').root.children as GroupNode[];
    assert.deepStrictEqual(g.range, { start: 0, end: 4 });
  });
});

describe('parse: environments', () => {
  test('environment with arguments and body', () => {
    assert.deepStrictEqual(
      shape(parse('\\begin{itemize}\\item[a] x\\end{itemize}').root.children),
      [
        {
          env: 'itemize',
          args: [],
          // The space is kept: \item's \ignorespaces is the renderer's job.
          body: [{ cmd: 'item', args: [{ opt: ['a'] }] }, ' ', 'x'],
        },
      ]
    );
  });

  test('environment range spans \\begin to \\end', () => {
    const src = 'x\\begin{center}y\\end{center}';
    const [, env] = parse(src).root.children as EnvironmentNode[];
    assert.deepStrictEqual(env.range, { start: 1, end: src.length });
  });

  test('an unclosed environment is an error at its \\begin', () => {
    const { root, diagnostics } = parse('\\begin{center}text');
    assert.deepStrictEqual(shape(root.children), [
      { env: 'center', args: [], body: ['text'] },
    ]);
    assert.strictEqual(diagnostics[0].code, 'syntax/unclosed-environment');
    assert.deepStrictEqual(diagnostics[0].range, { start: 0, end: 14 });
  });

  test('a mismatched \\end closes the inner environment when an outer one matches', () => {
    const { root, diagnostics } = parse(
      '\\begin{quote}\\begin{center}x\\end{quote}y'
    );
    assert.deepStrictEqual(shape(root.children), [
      {
        env: 'quote',
        args: [],
        body: [{ env: 'center', args: [], body: ['x'] }],
      },
      'y',
    ]);
    assert.deepStrictEqual(
      diagnostics.map((d) => d.code),
      ['syntax/unclosed-environment']
    );
  });

  test('an \\end with no matching \\begin is an error and is dropped', () => {
    const { root, diagnostics } = parse('a\\end{center}b');
    assert.deepStrictEqual(shape(root.children), ['a', 'b']);
    assert.strictEqual(diagnostics[0].code, 'syntax/unmatched-end');
  });

  test('\\begin without a name is an error', () => {
    assert.deepStrictEqual(codes('\\begin x'), [
      'syntax/missing-environment-name',
    ]);
  });

  test('unknown environments warn but keep their content', () => {
    const { root, diagnostics } = parse('\\begin{foo}x\\end{foo}');
    assert.deepStrictEqual(shape(root.children), [
      { env: 'foo', args: [], body: ['x'] },
    ]);
    assert.strictEqual(diagnostics[0].code, 'syntax/unknown-environment');
    assert.strictEqual(diagnostics[0].severity, 'warning');
  });

  test('verbatim environments', () => {
    assert.deepStrictEqual(
      shape(parse('\\begin{verbatim}$x$\\end{verbatim}').root.children),
      [{ verbatim: '$x$' }]
    );
    assert.deepStrictEqual(codes('\\begin{verbatim}x'), [
      'syntax/unclosed-environment',
    ]);
  });
});

describe('parse: math', () => {
  test('inline $…$', () => {
    const [m] = parse('$a^2$').root.children as MathNode[];
    assert.deepStrictEqual(shape([m]), [
      { math: 'inline', body: ['a', { special: '^' }, '2'] },
    ]);
    assert.strictEqual(m.source, 'a^2');
    assert.strictEqual(m.delimiter, '$');
  });

  test('display $$…$$, \\[…\\] and \\(…\\)', () => {
    assert.deepStrictEqual(shape(parse('$$x$$\\[y\\]\\(z\\)').root.children), [
      { math: 'display', body: ['x'] },
      { math: 'display', body: ['y'] },
      { math: 'inline', body: ['z'] },
    ]);
  });

  test('$x$$$y$$ is inline x then display y', () => {
    assert.deepStrictEqual(shape(parse('$x$$$y$$').root.children), [
      { math: 'inline', body: ['x'] },
      { math: 'display', body: ['y'] },
    ]);
  });

  test('math environments parse their body in math mode', () => {
    const [env] = parse('\\begin{equation}\\alpha\\end{equation}').root
      .children as EnvironmentNode[];
    assert.strictEqual(env.mathMode, true);
    assert.deepStrictEqual(
      parse('\\begin{equation}\\alpha\\end{equation}').diagnostics,
      []
    );
  });

  test('unknown commands inside math do not warn (math lands in a later milestone)', () => {
    assert.deepStrictEqual(codes('$\\alpha + \\frac{a}{b}$'), []);
  });

  test('math is closed at a paragraph break with an error', () => {
    const { root, diagnostics } = parse('$x\n\ny');
    assert.deepStrictEqual(shape(root.children), [
      { math: 'inline', body: ['x'] },
      '¶',
      'y',
    ]);
    assert.strictEqual(diagnostics[0].code, 'syntax/unclosed-math');
  });

  test('unclosed display math at end of input', () => {
    assert.deepStrictEqual(codes('\\[x'), ['syntax/unclosed-math']);
    assert.deepStrictEqual(codes('$$x'), ['syntax/unclosed-math']);
  });

  test('a stray \\] or \\) is an error', () => {
    assert.deepStrictEqual(codes('a\\]'), ['syntax/unexpected-math-close']);
  });
});

describe('parse: other tokens', () => {
  test('misplaced alignment/parameter/script characters in text are errors', () => {
    assert.deepStrictEqual(codes('a & b # c ^ d _ e ~ f'), [
      'syntax/misplaced-special',
      'syntax/misplaced-special',
      'syntax/misplaced-special',
      'syntax/misplaced-special',
    ]);
  });

  test('& is allowed inside tabular-like and align environments', () => {
    assert.deepStrictEqual(codes('\\begin{align}a&b\\end{align}'), []);
  });

  test('comments, verb and paragraph breaks are kept', () => {
    assert.deepStrictEqual(shape(parse('a%c\nb\n\n\\verb|x|').root.children), [
      'a',
      { comment: '%c\n' },
      'b',
      '¶',
      { verb: 'x' },
    ]);
  });

  test('an unterminated \\verb is an error', () => {
    assert.deepStrictEqual(codes('\\verb|abc'), ['syntax/unterminated-verb']);
  });

  test('the parser never throws on hostile input', () => {
    for (const src of [
      '}}}{{{',
      '\\begin{',
      '\\end',
      '$$$',
      '\\[\\]\\)',
      '\\',
      '\\item',
      '{\\begin{a}}',
    ]) {
      assert.doesNotThrow(() => parse(src));
    }
  });

  test('command node ranges include their arguments', () => {
    const [c] = parse('\\emph{ab} c').root.children as CommandNode[];
    assert.deepStrictEqual(c.range, { start: 0, end: 9 });
    assert.deepStrictEqual(c.nameRange, { start: 0, end: 5 });
  });
});
