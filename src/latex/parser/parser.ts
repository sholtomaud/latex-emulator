import { tokenize } from '../lexer/lexer.ts';
import type { Token } from '../lexer/lexer.ts';
import type {
  ArgNode,
  CommandNode,
  EnvironmentNode,
  MathNode,
  Node,
  RootNode,
} from '../ast/nodes.ts';
import type { Diagnostic, Severity } from '../diagnostics.ts';
import type { Range } from '../source.ts';
import { lookupCommand, lookupEnvironment } from '../commands/registry.ts';
import type { ArgSpec } from '../commands/registry.ts';

export interface ParseResult {
  root: RootNode;
  diagnostics: Diagnostic[];
}

/** What ends the node list currently being parsed. */
type Stop =
  | { kind: 'eof' }
  | { kind: 'group' }
  | { kind: 'optional' }
  | { kind: 'env'; name: string }
  | { kind: 'math'; close: '$' | '$$' | ')' | ']' };

interface Context {
  math: boolean;
  /** Inside a key/label/URL argument: specials are literal. */
  raw?: boolean;
  /** Innermost environment allows `&`. */
  alignment: boolean;
}

const CONTROL_WORD = /^[A-Za-z@]+$/;

/**
 * Error-tolerant LaTeX parser (AGENTS.md §4). Always returns a tree; problems
 * are reported as diagnostics with source ranges. Never throws.
 */
export function parse(src: string): ParseResult {
  return new Parser(src).parseDocument();
}

class Parser {
  tokens: Token[];
  i = 0;
  diagnostics: Diagnostic[] = [];
  /** Names of the environments currently open, innermost last. */
  envStack: string[] = [];
  src: string;

  constructor(src: string) {
    this.src = src;
    this.tokens = tokenize(src);
  }

  parseDocument(): ParseResult {
    const children = this.parseNodes(
      { kind: 'eof' },
      {
        math: false,
        alignment: false,
      }
    );
    return {
      root: {
        kind: 'root',
        children,
        range: { start: 0, end: this.src.length },
      },
      diagnostics: this.diagnostics,
    };
  }

  // ---------------------------------------------------------------- helpers

  peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }

  report(
    range: Range,
    code: string,
    message: string,
    severity: Severity = 'error'
  ) {
    this.diagnostics.push({ range, code, message, severity, source: 'syntax' });
  }

  /** Is the token `\end{…}`? Returns the environment name if so. */
  endName(at = this.i): string | undefined {
    const t = this.tokens[at];
    if (t?.type !== 'command' || t.value !== 'end') return undefined;
    let j = at + 1;
    while (this.tokens[j]?.type === 'space') j++;
    if (this.tokens[j]?.type !== 'begin-group') return '';
    let name = '';
    for (
      j++;
      j < this.tokens.length && this.tokens[j].type !== 'end-group';
      j++
    )
      name += this.tokens[j].raw;
    return name.trim();
  }

  /** Consume `\end{name}` (or `\begin{name}`) and return its full range. */
  consumeEnvTag(): Range {
    const start = this.tokens[this.i].range.start;
    this.i++;
    this.skipSpaces();
    if (this.peek()?.type !== 'begin-group')
      return { start, end: this.tokens[this.i - 1].range.end };
    while (this.i < this.tokens.length && this.peek()!.type !== 'end-group')
      this.i++;
    const close = this.peek();
    if (close) this.i++;
    return { start, end: (close ?? this.tokens[this.i - 1]).range.end };
  }

  skipSpaces({ comments = true } = {}) {
    while (
      this.peek()?.type === 'space' ||
      (comments && this.peek()?.type === 'comment')
    )
      this.i++;
  }

  /** Split a text token so that its first `n` code units are their own token. */
  splitText(at: number, n: number) {
    const t = this.tokens[at];
    if (t.raw.length <= n) return;
    const mid = t.range.start + n;
    const first: Token = {
      ...t,
      value: t.raw.slice(0, n),
      raw: t.raw.slice(0, n),
      range: { start: t.range.start, end: mid },
    };
    const rest: Token = {
      ...t,
      value: t.raw.slice(n),
      raw: t.raw.slice(n),
      range: { start: mid, end: t.range.end },
    };
    this.tokens.splice(at, 1, first, rest);
  }

  isStop(stop: Stop): boolean {
    const t = this.peek();
    if (!t) return true;
    switch (stop.kind) {
      case 'eof':
        return false;
      case 'group':
        return t.type === 'end-group';
      case 'optional':
        return t.type === 'text' && t.raw === ']';
      case 'env':
        return (
          this.endName() !== undefined &&
          this.envStack.includes(this.endName()!)
        );
      case 'math':
        if (t.type === 'parbreak') return true;
        if (stop.close === '$') return t.type === 'math-shift';
        if (stop.close === '$$')
          return t.type === 'math-shift' && this.peek(1)?.type === 'math-shift';
        return t.type === 'command' && t.value === stop.close;
    }
  }

  // ---------------------------------------------------------------- lists

  parseNodes(stop: Stop, ctx: Context): Node[] {
    const nodes: Node[] = [];
    while (this.i < this.tokens.length && !this.isStop(stop)) {
      // An \end for an enclosing environment ends any nested list too.
      const end = this.endName();
      if (
        end !== undefined &&
        stop.kind !== 'env' &&
        this.envStack.includes(end)
      )
        break;
      const node = this.parseNode(ctx);
      if (node) nodes.push(node);
    }
    return mergeText(nodes);
  }

  parseNode(ctx: Context): Node | undefined {
    const t = this.tokens[this.i];
    switch (t.type) {
      case 'text':
        this.i++;
        return { kind: 'text', value: t.raw, range: t.range };
      case 'space':
        this.i++;
        return { kind: 'space', range: t.range };
      case 'parbreak':
        this.i++;
        return { kind: 'parbreak', range: t.range };
      case 'comment':
        this.i++;
        return { kind: 'comment', value: t.raw, range: t.range };
      case 'verb':
        this.i++;
        if (t.unterminated)
          this.report(
            t.range,
            'syntax/unterminated-verb',
            '\\verb is missing its closing delimiter.'
          );
        return { kind: 'verb', value: t.value, star: !!t.star, range: t.range };
      case 'verbatim':
        this.i++;
        if (t.unterminated)
          this.report(
            {
              start: t.range.start,
              end: t.range.start + `\\begin{${t.env}}`.length,
            },
            'syntax/unclosed-environment',
            `\\begin{${t.env}} is never closed.`
          );
        return {
          kind: 'verbatim',
          value: t.value,
          env: t.env!,
          range: t.range,
        };
      case 'begin-group':
        return this.parseGroup(ctx);
      case 'end-group':
        this.i++;
        this.report(
          t.range,
          'syntax/unexpected-close-brace',
          'Unexpected }: no group is open.'
        );
        return undefined;
      case 'math-shift':
        return this.parseDollarMath(ctx);
      case 'special':
        this.i++;
        this.checkSpecial(t, ctx);
        return { kind: 'special', char: t.raw, range: t.range };
      case 'command':
        return this.parseCommand(ctx);
    }
  }

  checkSpecial(t: Token, ctx: Context) {
    if (ctx.raw) return;
    const c = t.raw;
    const ok =
      c === '~' ||
      (c === '&' && ctx.alignment) ||
      ((c === '^' || c === '_') && ctx.math);
    if (!ok)
      this.report(
        t.range,
        'syntax/misplaced-special',
        `“${c}” has a special meaning here; write \\${c === '^' ? 'textasciicircum' : c} to print it.`
      );
  }

  parseGroup(ctx: Context): Node {
    const open = this.tokens[this.i++];
    const children = this.parseNodes({ kind: 'group' }, ctx);
    const close = this.peek();
    if (close?.type === 'end-group') {
      this.i++;
      return {
        kind: 'group',
        children,
        range: { start: open.range.start, end: close.range.end },
      };
    }
    this.report(open.range, 'syntax/unclosed-group', 'This { is never closed.');
    return {
      kind: 'group',
      children,
      range: { start: open.range.start, end: this.lastEnd() },
    };
  }

  lastEnd(): number {
    return this.tokens[this.i - 1]?.range.end ?? 0;
  }

  // ---------------------------------------------------------------- math

  parseDollarMath(ctx: Context): Node | undefined {
    const open = this.tokens[this.i];
    if (ctx.math) {
      this.i++;
      this.report(
        open.range,
        'syntax/unexpected-math-shift',
        'Unexpected $ inside math.'
      );
      return undefined;
    }
    const display =
      this.peek(1)?.type === 'math-shift' &&
      this.peek(1)!.range.start === open.range.end;
    this.i += display ? 2 : 1;
    return this.parseMathBody(open.range.start, display ? '$$' : '$', ctx);
  }

  parseMathBody(
    start: number,
    delimiter: MathNode['delimiter'],
    ctx: Context
  ): MathNode {
    const openEnd = this.lastEnd();
    const close =
      delimiter === '\\(' ? ')' : delimiter === '\\[' ? ']' : delimiter;
    const children = this.parseNodes(
      { kind: 'math', close },
      { math: true, alignment: ctx.alignment }
    );
    const contentEnd = this.peek()?.range.start ?? this.src.length;
    const t = this.peek();
    const closed =
      t !== undefined &&
      t.type !== 'parbreak' &&
      this.isStop({ kind: 'math', close });
    if (closed) this.i += close === '$$' ? 2 : 1;
    else
      this.report(
        { start, end: openEnd },
        'syntax/unclosed-math',
        `Math started with ${delimiter} is never closed.`
      );
    return {
      kind: 'math',
      display: delimiter === '$$' || delimiter === '\\[',
      delimiter,
      children,
      source: this.src.slice(openEnd, contentEnd),
      range: { start, end: closed ? this.lastEnd() : contentEnd },
    };
  }

  // ---------------------------------------------------------------- commands

  parseCommand(ctx: Context): Node | undefined {
    const t = this.tokens[this.i];
    const name = t.value;

    if (name === 'begin') return this.parseEnvironment(ctx);
    if (name === 'end') {
      const range = this.consumeEnvTag();
      this.report(
        range,
        'syntax/unmatched-end',
        `${this.src.slice(range.start, range.end)} has no matching \\begin.`
      );
      return undefined;
    }
    if ((name === '(' || name === '[') && !ctx.math) {
      this.i++;
      return this.parseMathBody(
        t.range.start,
        name === '(' ? '\\(' : '\\[',
        ctx
      );
    }
    if (name === ')' || name === ']') {
      this.i++;
      this.report(
        t.range,
        'syntax/unexpected-math-close',
        `\\${name} without a matching opening delimiter.`
      );
      return undefined;
    }

    this.i++;
    if (CONTROL_WORD.test(name)) this.skipSpaces({ comments: false });

    const spec = lookupCommand(name);
    if (!spec && !ctx.math)
      this.report(
        t.range,
        'syntax/unknown-command',
        `\\${name} is not supported by the emulator; its arguments are shown as plain text.`,
        'warning'
      );

    const node: CommandNode = {
      kind: 'command',
      name,
      star: false,
      args: [],
      nameRange: t.range,
      range: t.range,
    };
    if (spec) this.parseArgs(node, spec.args, ctx, spec.raw);
    else this.parseAdjacentArgs(node, ctx);
    return node;
  }

  parseArgs(
    node: CommandNode | EnvironmentNode,
    specs: ArgSpec[],
    ctx: Context,
    /** Mandatory arguments are keys/labels/URLs (see CommandSpec.raw). */
    raw = false
  ) {
    for (const spec of specs) {
      if (spec === 's') {
        const save = this.i;
        this.skipSpaces();
        const t = this.peek();
        if (
          t?.type === 'text' &&
          t.raw.startsWith('*') &&
          node.kind === 'command'
        ) {
          this.splitText(this.i, 1);
          node.star = true;
          node.nameRange = {
            start: node.nameRange.start,
            end: this.tokens[this.i].range.end,
          };
          this.i++;
        } else this.i = save;
      } else if (spec === 'o') {
        const save = this.i;
        this.skipSpaces();
        if (this.peek()?.type === 'text' && this.peek()!.raw === '[')
          node.args.push(this.parseOptionalArg(ctx));
        else this.i = save;
      } else {
        node.args.push(
          this.parseMandatoryArg(node, raw ? { ...ctx, raw: true } : ctx)
        );
      }
    }
    if (node.kind === 'command' && node.args.length)
      node.range = {
        start: node.range.start,
        end: node.args.at(-1)!.range.end,
      };
    else if (node.kind === 'command')
      node.range = { start: node.range.start, end: node.nameRange.end };
  }

  /**
   * Generic parsing for unknown commands: take directly attached [..] and
   * {..}. In math, [ is a delimiter (\left[, \big[), never an optional
   * argument: TeX only gives optional arguments to commands that define one.
   */
  parseAdjacentArgs(node: CommandNode, ctx: Context) {
    for (;;) {
      const t = this.peek();
      if (
        t?.type === 'text' &&
        t.raw === '[' &&
        this.isAdjacent() &&
        !ctx.math
      ) {
        node.args.push(this.parseOptionalArg(ctx));
      } else if (t?.type === 'begin-group' && this.isAdjacent()) {
        const group = this.parseGroup(ctx) as {
          children: Node[];
          range: Range;
        };
        node.args.push({
          kind: 'arg',
          optional: false,
          children: group.children,
          range: group.range,
        });
      } else break;
    }
    if (node.args.length)
      node.range = {
        start: node.range.start,
        end: node.args.at(-1)!.range.end,
      };
  }

  /** The next token starts exactly where the previous one ended. */
  isAdjacent(): boolean {
    const prev = this.tokens[this.i - 1];
    const next = this.tokens[this.i];
    return !!prev && !!next && prev.range.end === next.range.start;
  }

  parseOptionalArg(ctx: Context): ArgNode {
    const open = this.tokens[this.i++];
    const children = this.parseNodes({ kind: 'optional' }, ctx);
    const close = this.peek();
    if (close?.type === 'text' && close.raw === ']') {
      this.i++;
      return {
        kind: 'arg',
        optional: true,
        children,
        range: { start: open.range.start, end: close.range.end },
      };
    }
    this.report(
      open.range,
      'syntax/unclosed-optional-argument',
      'This [ is never closed.'
    );
    return {
      kind: 'arg',
      optional: true,
      children,
      range: { start: open.range.start, end: this.lastEnd() },
    };
  }

  parseMandatoryArg(
    node: CommandNode | EnvironmentNode,
    ctx: Context
  ): ArgNode {
    this.skipSpaces();
    const t = this.peek();
    const missing = (): ArgNode => {
      const at = this.lastEnd();
      const label =
        node.kind === 'command' ? `\\${node.name}` : `\\begin{${node.name}}`;
      this.report(
        node.kind === 'command' ? node.nameRange : node.range,
        'syntax/missing-argument',
        `${label} is missing a required argument.`
      );
      return {
        kind: 'arg',
        optional: false,
        children: [],
        range: { start: at, end: at },
      };
    };
    if (!t) return missing();
    switch (t.type) {
      case 'begin-group': {
        const group = this.parseGroup(ctx) as {
          children: Node[];
          range: Range;
        };
        return {
          kind: 'arg',
          optional: false,
          children: group.children,
          range: group.range,
        };
      }
      case 'text': {
        // TeX takes a single token: the first character.
        const n = t.raw.codePointAt(0)! > 0xffff ? 2 : 1;
        this.splitText(this.i, n);
        const one = this.tokens[this.i++];
        return {
          kind: 'arg',
          optional: false,
          children: [{ kind: 'text', value: one.raw, range: one.range }],
          range: one.range,
        };
      }
      case 'command':
      case 'special':
      case 'verb': {
        if (this.endName() !== undefined) return missing();
        const child = this.parseNode(ctx);
        const children = child ? [child] : [];
        return {
          kind: 'arg',
          optional: false,
          children,
          range: child?.range ?? t.range,
        };
      }
      default:
        return missing();
    }
  }

  // ---------------------------------------------------------------- environments

  parseEnvironment(ctx: Context): Node | undefined {
    const begin = this.tokens[this.i];
    const save = this.i;
    this.i++;
    this.skipSpaces();
    if (this.peek()?.type !== 'begin-group') {
      this.report(
        begin.range,
        'syntax/missing-environment-name',
        '\\begin needs an environment name in braces.'
      );
      return undefined;
    }
    this.i = save;
    const name = this.beginName();
    const tagRange = this.consumeEnvTag();
    if (!name) {
      this.report(
        tagRange,
        'syntax/missing-environment-name',
        '\\begin needs an environment name in braces.'
      );
      return undefined;
    }

    const spec = lookupEnvironment(name);
    if (!spec)
      this.report(
        tagRange,
        'syntax/unknown-environment',
        `The ${name} environment is not supported by the emulator; its content is shown as plain text.`,
        'warning'
      );

    const node: EnvironmentNode = {
      kind: 'environment',
      name,
      args: [],
      children: [],
      mathMode: !!spec?.math,
      range: tagRange,
    };
    const bodyCtx: Context = {
      math: ctx.math || !!spec?.math,
      alignment: !!spec?.alignment,
    };
    if (spec) this.parseArgs(node, spec.args, ctx);

    this.envStack.push(name);
    node.children = this.parseNodes({ kind: 'env', name }, bodyCtx);
    this.envStack.pop();

    if (this.endName() === name) {
      const endRange = this.consumeEnvTag();
      node.range = { start: tagRange.start, end: endRange.end };
    } else {
      // EOF, or an \end for an outer environment: leave it for the outer one.
      this.report(
        tagRange,
        'syntax/unclosed-environment',
        `\\begin{${name}} is never closed.`
      );
      node.range = { start: tagRange.start, end: this.lastEnd() };
    }
    return node;
  }

  /** Name inside the braces after the \begin at the cursor. */
  beginName(): string {
    let j = this.i + 1;
    while (this.tokens[j]?.type === 'space') j++;
    let name = '';
    for (
      j++;
      j < this.tokens.length && this.tokens[j].type !== 'end-group';
      j++
    )
      name += this.tokens[j].raw;
    return name.trim();
  }
}

/** Join adjacent text nodes (the lexer splits on brackets). */
function mergeText(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const prev = out.at(-1);
    if (
      n.kind === 'text' &&
      prev?.kind === 'text' &&
      prev.range.end === n.range.start
    ) {
      out[out.length - 1] = {
        kind: 'text',
        value: prev.value + n.value,
        range: { start: prev.range.start, end: n.range.end },
      };
    } else out.push(n);
  }
  return out;
}
