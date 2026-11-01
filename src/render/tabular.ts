/**
 * tabular's column specification and rows, from the parser's AST (latex.ltx
 * \@mkpream and array.sty for the spec; booktabs for its rules). Pure; the
 * renderer turns the result into an HTML table.
 */
import type { CommandNode, Node } from '../latex/ast/nodes.ts';
import { keyText, toLatex } from '../latex/ast/to-latex.ts';
import { parseLength } from './lengths.ts';
import type { LengthContext } from './lengths.ts';

export type Column =
  | {
      kind: 'cell';
      align: 'l' | 'c' | 'r' | 'p';
      /** p{…} width in bp. */
      width?: number;
      /** \tabcolsep on each side (removed by an adjacent @{…}). */
      padLeft: boolean;
      padRight: boolean;
    }
  | { kind: 'rule' }
  /** \doublerulesep between the rules of || */
  | { kind: 'gap' }
  /** @{…} with content: a column of its own, in every row. */
  | { kind: 'sep'; nodes: Node[] };

type Token = { kind: 'char'; c: string } | { kind: 'group'; nodes: Node[] };

function tokens(nodes: Node[]): Token[] {
  const out: Token[] = [];
  for (const n of nodes) {
    if (n.kind === 'text')
      for (const c of n.value) if (!/\s/.test(c)) out.push({ kind: 'char', c });
    if (n.kind === 'special') out.push({ kind: 'char', c: n.char });
    if (n.kind === 'group') out.push({ kind: 'group', nodes: n.children });
    if (n.kind === 'command') out.push({ kind: 'char', c: `\\${n.name}` });
  }
  return out;
}

export function parseColumnSpec(
  nodes: Node[],
  ctx: LengthContext
): { columns: Column[]; problems: string[] } {
  const columns: Column[] = [];
  const problems: string[] = [];
  const toks = tokens(nodes);
  /** The last cell column, if nothing but separators follow it. */
  const lastCell = () => {
    const c = columns.at(-1);
    return c?.kind === 'cell' ? c : null;
  };
  let noPadNext = false;
  const expand = (toks: Token[]): Token[] => {
    const out: Token[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const count = toks[i + 1];
      const body = toks[i + 2];
      if (
        t.kind === 'char' &&
        t.c === '*' &&
        count?.kind === 'group' &&
        body?.kind === 'group'
      ) {
        const n = Number(keyText(count.nodes).trim()) || 0;
        for (let k = 0; k < n; k++) out.push(...expand(tokens(body.nodes)));
        i += 2;
      } else out.push(t);
    }
    return out;
  };
  const all = expand(toks);
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    if (t.kind === 'group') continue;
    const c = t.c;
    if (c === 'l' || c === 'c' || c === 'r') {
      columns.push({
        kind: 'cell',
        align: c,
        padLeft: !noPadNext,
        padRight: true,
      });
      noPadNext = false;
    } else if (c === 'p' || c === 'm' || c === 'b') {
      const arg =
        all[i + 1]?.kind === 'group'
          ? (all[i + 1] as { nodes: Node[] }).nodes
          : null;
      const width = arg ? parseLength(toLatex(arg), ctx) : null;
      if (arg) i++;
      columns.push({
        kind: 'cell',
        align: 'p',
        ...(width !== null ? { width } : {}),
        padLeft: !noPadNext,
        padRight: true,
      });
      noPadNext = false;
    } else if (c === '|') {
      if (columns.at(-1)?.kind === 'rule') columns.push({ kind: 'gap' });
      columns.push({ kind: 'rule' });
    } else if (c === '@' || c === '!') {
      const arg =
        all[i + 1]?.kind === 'group'
          ? (all[i + 1] as { nodes: Node[] }).nodes
          : [];
      if (all[i + 1]?.kind === 'group') i++;
      if (c === '@') {
        const prev = lastCell();
        if (prev) prev.padRight = false;
        noPadNext = true;
      }
      if (keyText(arg).trim()) columns.push({ kind: 'sep', nodes: arg });
    } else if (c === '>' || c === '<') {
      problems.push(`${c}{…}`);
      if (all[i + 1]?.kind === 'group') i++;
    } else problems.push(c);
  }
  return { columns, problems };
}

export interface Cell {
  nodes: Node[];
  /** Columns spanned (\multicolumn). */
  span: number;
  /** \multicolumn's own column spec. */
  columns?: Column[];
}

export type TabularRow =
  | { kind: 'cells'; cells: Cell[] }
  | { kind: 'rule'; rule: 'hline' | 'toprule' | 'midrule' | 'bottomrule' }
  | {
      kind: 'partial';
      rule: 'cline' | 'cmidrule';
      /** 1-based columns, inclusive. */
      from: number;
      to: number;
      trimLeft: boolean;
      trimRight: boolean;
    };

const FULL_RULES = new Set(['hline', 'toprule', 'midrule', 'bottomrule']);
const blank = (nodes: Node[]) =>
  nodes.every(
    (n) => n.kind === 'space' || n.kind === 'comment' || n.kind === 'parbreak'
  );

/** "a-b" → [a, b] (1-based); a single number spans one column. */
function columnRange(text: string): [number, number] | null {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(text);
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}

export function tabularRows(
  nodes: Node[],
  ctx: LengthContext = { textwidth: 0, em: 0, ex: 0 }
): TabularRow[] {
  const rows: TabularRow[] = [];
  let cells: Cell[] = [{ nodes: [], span: 1 }];
  const rowStarted = () => cells.length > 1 || !blank(cells[0].nodes);
  const endRow = () => {
    if (rowStarted()) rows.push({ kind: 'cells', cells });
    cells = [{ nodes: [], span: 1 }];
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'special' && n.char === '&') {
      cells.push({ nodes: [], span: 1 });
      continue;
    }
    if (n.kind === 'command') {
      if (n.name === '\\' || n.name === 'tabularnewline' || n.name === 'cr') {
        endRow();
        continue;
      }
      if (!rowStarted() && FULL_RULES.has(n.name)) {
        rows.push({ kind: 'rule', rule: n.name as 'hline' });
        continue;
      }
      if (!rowStarted() && (n.name === 'cline' || n.name === 'cmidrule')) {
        let trim = '';
        let rangeText = keyText(lastArg(n));
        // \cmidrule(lr){a-b}: the trim is text, the range the next group.
        if (n.name === 'cmidrule') {
          let j = i + 1;
          while (nodes[j]?.kind === 'space') j++;
          const next = nodes[j];
          if (
            next?.kind === 'text' &&
            /^\([lr{}0-9a-z.]*\)$/.test(next.value.trim())
          ) {
            trim = next.value;
            j++;
            while (nodes[j]?.kind === 'space') j++;
          }
          const g = nodes[j];
          if (!rangeText && g?.kind === 'group') {
            rangeText = keyText(g.children);
            i = j;
          }
        }
        const range = columnRange(rangeText);
        if (range)
          rows.push({
            kind: 'partial',
            rule: n.name,
            from: range[0],
            to: range[1],
            trimLeft: /l/.test(trim),
            trimRight: /r/.test(trim),
          });
        continue;
      }
      if (n.name === 'multicolumn' && blank(cells.at(-1)!.nodes)) {
        const args = n.args.filter((a) => !a.optional);
        const cell = cells.at(-1)!;
        cell.span = Math.max(
          1,
          Number(keyText(args[0]?.children ?? []).trim()) || 1
        );
        cell.columns = parseColumnSpec(args[1]?.children ?? [], ctx).columns;
        cell.nodes = args[2]?.children ?? [];
        continue;
      }
    }
    cells.at(-1)!.nodes.push(n);
  }
  endRow();
  return rows;
}

function lastArg(c: CommandNode): Node[] {
  return c.args.filter((a) => !a.optional).at(-1)?.children ?? [];
}
