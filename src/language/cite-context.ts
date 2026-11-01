/**
 * Is the cursor in the key list of a citation command? Works on the
 * parser's AST (AGENTS.md §4), which tolerates the unclosed brace of a
 * citation being typed. Pure: no Monaco.
 */
import { parse } from '../latex/parser/parser.ts';
import { CITE_COMMANDS } from '../latex/commands/registry.ts';
import type { CommandNode, Node } from '../latex/ast/nodes.ts';
import type { Range } from '../latex/source.ts';

export interface CiteContext {
  /** The part of the key before the cursor. */
  prefix: string;
  /** The whole key under the cursor (what a completion replaces). */
  replace: Range;
  /** Every key in the list, as written. */
  keys: string[];
}

function findCite(nodes: Node[], offset: number): CommandNode | null {
  for (const n of nodes) {
    if (n.range.end < offset - 1 || n.range.start > offset) continue;
    if (n.kind === 'command') {
      if (
        (CITE_COMMANDS.has(n.name) || n.name === 'nocite') &&
        n.range.start < offset
      )
        return n;
      for (const a of n.args) {
        const found = findCite(a.children, offset);
        if (found) return found;
      }
    } else if (
      n.kind === 'group' ||
      n.kind === 'environment' ||
      n.kind === 'math'
    ) {
      const found = findCite(n.children, offset);
      if (found) return found;
    }
  }
  return null;
}

const KEY_END = /[,}\s]/;

export function citeContextAt(
  text: string,
  offset: number
): CiteContext | null {
  const cite = findCite(parse(text).root.children, offset);
  const arg = cite?.args.filter((a) => !a.optional).at(-1);
  if (!arg || text[arg.range.start] !== '{') return null;
  const closed =
    text[arg.range.end - 1] === '}' && arg.range.end - 1 > arg.range.start;
  const contentEnd = closed ? arg.range.end - 1 : arg.range.end;
  if (offset <= arg.range.start || offset > contentEnd) return null;

  const before = text.slice(arg.range.start + 1, offset);
  const comma = before.lastIndexOf(',');
  const keyStart =
    arg.range.start +
    1 +
    comma +
    1 +
    (before.slice(comma + 1).length -
      before.slice(comma + 1).trimStart().length);
  let keyEnd = offset;
  while (keyEnd < contentEnd && !KEY_END.test(text[keyEnd])) keyEnd++;
  return {
    prefix: text.slice(keyStart, offset),
    replace: { start: keyStart, end: keyEnd },
    keys: text
      .slice(arg.range.start + 1, contentEnd)
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  };
}
