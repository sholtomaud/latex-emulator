/**
 * algorithmic (algorithmicx.sty) with the algpseudocode layout: the body's
 * flat node list → one entry per printed line, with its nesting depth,
 * line number and keywords. Pure; no DOM (ADR 0016).
 *
 * Inline commands (\Return, \Call) stay in the content; the renderer gives
 * them their text. \Comment is pulled out: it is set flush right.
 */
import type { CommandNode, EnvironmentNode, Node } from '../ast/nodes.ts';
import { keyText } from '../ast/to-latex.ts';
import type { Range } from '../source.ts';

export type AlgPart =
  /** A bold keyword (algpseudocode's \algorithmicwhile etc.). */
  | { kind: 'keyword'; text: string }
  /** Literal text: the control spaces and parentheses around arguments. */
  | { kind: 'text'; text: string }
  /** The user's own content. */
  | { kind: 'nodes'; nodes: Node[] }
  /** A procedure name: \textproc = \textsc. */
  | { kind: 'proc'; nodes: Node[] };

export interface AlgLine {
  /** A \Require/\Ensure label in the margin, a number, or nothing. */
  label: 'require' | 'ensure' | 'none';
  /** The printed number (\alglinenumber), or null. */
  number: number | null;
  /** ALG@line after this line: what \label refers to here. */
  line: number;
  /** Nesting level, in \algorithmicindent units. */
  depth: number;
  parts: AlgPart[];
  /** \Comment{…}'s argument, or null. */
  comment: Node[] | null;
  /** The command that starts the line. */
  range: Range;
}

export interface AlgProblem {
  range: Range;
  message: string;
}

type Block =
  | 'if'
  | 'else'
  | 'for'
  | 'while'
  | 'repeat'
  | 'loop'
  | 'procedure'
  | 'function';

/** Commands that open a block, the block, and what closes it. */
const OPENERS: Record<string, [Block, string]> = {
  If: ['if', 'EndIf'],
  For: ['for', 'EndFor'],
  ForAll: ['for', 'EndFor'],
  While: ['while', 'EndWhile'],
  Repeat: ['repeat', 'Until'],
  Loop: ['loop', 'EndLoop'],
  Procedure: ['procedure', 'EndProcedure'],
  Function: ['function', 'EndFunction'],
};

/** Closing commands and the blocks each may close. */
const CLOSERS: Record<string, [Block[], string]> = {
  EndIf: [['if', 'else'], 'If'],
  EndFor: [['for'], 'For'],
  EndWhile: [['while'], 'While'],
  Until: [['repeat'], 'Repeat'],
  EndLoop: [['loop'], 'Loop'],
  EndProcedure: [['procedure'], 'Procedure'],
  EndFunction: [['function'], 'Function'],
};

/** Commands that start a new line (an \item in algorithmicx). */
const LINE_COMMANDS = new Set([
  'State',
  'Statex',
  'Require',
  'Ensure',
  'ElsIf',
  'Else',
  ...Object.keys(OPENERS),
  ...Object.keys(CLOSERS),
]);

const kw = (text: string): AlgPart => ({ kind: 'keyword', text });
const SP: AlgPart = { kind: 'text', text: ' ' };
const arg = (c: CommandNode, i: number): Node[] =>
  c.args.filter((a) => !a.optional)[i]?.children ?? [];
const nodes = (n: Node[]): AlgPart => ({ kind: 'nodes', nodes: n });
/** Without trailing white space (before a \Comment's \hfill). */
function trimEnd(n: Node[]): Node[] {
  let end = n.length;
  while (end > 0 && n[end - 1].kind === 'space') end--;
  return n.slice(0, end);
}
const blank = (n: Node[]) =>
  n.every(
    (x) => x.kind === 'space' || x.kind === 'comment' || x.kind === 'parbreak'
  );

/** \Procedure{N}{a}: \textproc{N}, then (a) unless a is empty. */
function called(c: CommandNode, keyword: string): AlgPart[] {
  const args = arg(c, 1);
  return [
    kw(keyword),
    SP,
    { kind: 'proc', nodes: arg(c, 0) },
    ...(blank(args)
      ? []
      : [
          { kind: 'text', text: '(' } as AlgPart,
          nodes(args),
          { kind: 'text', text: ')' } as AlgPart,
        ]),
  ];
}

/** What a line-starting command prints (algpseudocode.sty's \algdef). */
function opening(c: CommandNode): AlgPart[] {
  switch (c.name) {
    case 'While':
      return [kw('while'), SP, nodes(arg(c, 0)), SP, kw('do')];
    case 'For':
      return [kw('for'), SP, nodes(arg(c, 0)), SP, kw('do')];
    case 'ForAll':
      return [kw('for all'), SP, nodes(arg(c, 0)), SP, kw('do')];
    case 'Loop':
      return [kw('loop')];
    case 'Repeat':
      return [kw('repeat')];
    case 'Until':
      return [kw('until'), SP, nodes(arg(c, 0))];
    case 'If':
      return [kw('if'), SP, nodes(arg(c, 0)), SP, kw('then')];
    case 'ElsIf':
      return [kw('else'), SP, kw('if'), SP, nodes(arg(c, 0)), SP, kw('then')];
    case 'Else':
      return [kw('else')];
    case 'Procedure':
      return called(c, 'procedure');
    case 'Function':
      return called(c, 'function');
    default:
      // EndIf → end if, EndProcedure → end procedure, …
      return c.name.startsWith('End')
        ? [kw('end'), SP, kw(c.name.slice(3).toLowerCase())]
        : [];
  }
}

export function algorithmicLines(
  env: EnvironmentNode,
  { noend = false }: { noend?: boolean } = {}
): { lines: AlgLine[]; problems: AlgProblem[] } {
  // \begin{algorithmic}[n]: number every n-th line; 0 (the default) none.
  const freqArg = env.args.find((a) => a.optional);
  const freq = Math.max(
    0,
    Number.parseInt(keyText(freqArg?.children ?? []), 10) || 0
  );
  const lines: AlgLine[] = [];
  const problems: AlgProblem[] = [];
  const stack: { block: Block; opener: CommandNode }[] = [];
  let lineCounter = 0;
  let rem = 0;
  /** Where the current line's content goes; null drops it (a noend line). */
  let current: AlgLine | null = null;
  let pending: Node[] = [];

  const flushPending = () => {
    if (!current) {
      if (!blank(pending)) {
        const first = pending.find(
          (n) => n.kind !== 'space' && n.kind !== 'comment'
        )!;
        problems.push({
          range: first.range,
          message:
            'Text before the first \\State: start each line with \\State.',
        });
        current = {
          label: 'none',
          number: null,
          line: lineCounter,
          depth: stack.length,
          parts: [],
          comment: null,
          range: first.range,
        };
        lines.push(current);
      } else {
        pending = [];
        return;
      }
    }
    const content = pending.filter(
      (n) => n.kind !== 'comment' && n.kind !== 'parbreak'
    );
    pending = [];
    if (blank(content)) return;
    // After \Comment (\hfill ▷ #1, with nothing to end it), the rest of
    // the line is set after the comment's text.
    if (current.comment) current.comment.push(...content);
    else current.parts.push(nodes(trimEnd(content)));
  };

  const startLine = (
    c: CommandNode,
    depth: number,
    numbered: boolean,
    label: AlgLine['label'] = 'none'
  ) => {
    let number: number | null = null;
    if (numbered) {
      // \ALG@step: every statement counts; every freq-th is numbered.
      lineCounter++;
      rem++;
      if (rem === freq) {
        rem = 0;
        number = lineCounter;
      }
    }
    current = {
      label,
      number,
      line: lineCounter,
      depth,
      parts: opening(c),
      comment: null,
      range: c.range,
    };
    lines.push(current);
  };

  /** Close blocks until one of `blocks` is closed; false when none is open. */
  const closeTo = (blocks: Block[]): boolean => {
    const at = stack.findLastIndex((s) => blocks.includes(s.block));
    if (at < 0) return false;
    for (const inner of stack.splice(at + 1).reverse())
      problems.push(notClosed(inner.opener));
    stack.pop();
    return true;
  };

  for (const n of env.children) {
    if (
      n.kind !== 'command' ||
      (!LINE_COMMANDS.has(n.name) && n.name !== 'Comment')
    ) {
      pending.push(n);
      continue;
    }
    if (n.name === 'Comment') {
      flushPending();
      // flushPending may have started a line; TS can't see that.
      const line = current as AlgLine | null;
      // Comment text first; anything after it joins it (flushPending).
      if (line) line.comment = [...(line.comment ?? []), ...arg(n, 0)];
      continue;
    }
    flushPending();
    const name = n.name;
    if (name === 'State') startLine(n, stack.length, true);
    else if (name === 'Statex') startLine(n, stack.length, false);
    else if (name === 'Require' || name === 'Ensure')
      startLine(
        n,
        stack.length,
        false,
        name === 'Require' ? 'require' : 'ensure'
      );
    else if (OPENERS[name]) {
      startLine(n, stack.length, true);
      stack.push({ block: OPENERS[name][0], opener: n });
    } else if (name === 'ElsIf' || name === 'Else') {
      const top = stack.at(-1);
      if (top?.block !== 'if') {
        problems.push({
          range: n.range,
          message: `\\${name} has no \\If to belong to${top?.block === 'else' ? ' (it follows \\Else)' : ''}.`,
        });
        startLine(n, stack.length, true);
      } else {
        startLine(n, stack.length - 1, true);
        if (name === 'Else') top.block = 'else';
      }
    } else {
      const [blocks, opener] = CLOSERS[name];
      if (!closeTo(blocks))
        problems.push({
          range: n.range,
          message: `\\${name} has no \\${opener} to close.`,
        });
      // noend (\algtext*): closing lines print nothing and take no number.
      // \Until is not one of them: it always prints its condition.
      if (noend && name !== 'Until') current = null;
      else startLine(n, stack.length, true);
    }
  }
  flushPending();
  for (const open of stack) problems.push(notClosed(open.opener));
  return { lines, problems };
}

function notClosed(c: CommandNode): AlgProblem {
  const end = OPENERS[c.name][1];
  return {
    range: c.range,
    message: `\\${c.name} is not closed: add \\${end}.`,
  };
}
