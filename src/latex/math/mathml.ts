/**
 * TeX math → MathML Core, from the parser's AST (no re-parsing of source).
 * Pure: produces a plain element tree that the renderer turns into DOM with
 * createElementNS. Symbols and operators live in ./symbols.ts, the math
 * part of the command registry.
 */
import type { CommandNode, EnvironmentNode, Node } from '../ast/nodes.ts';
import type { Diagnostic } from '../diagnostics.ts';
import type { Range } from '../source.ts';
import {
  ACCENTS,
  BIG_DELIMITER_SIZES,
  BIG_OPERATORS,
  DELIMITERS,
  FUNCTIONS,
  LIMIT_FUNCTIONS,
  MATRIX_FENCES,
  ORDINARY,
  OPERATORS,
  SPACES,
  mapAlphabet,
} from './symbols.ts';
import type { Alphabet } from './symbols.ts';

export interface MElement {
  tag: string;
  attrs: Record<string, string>;
  children: MChild[];
}
export type MChild = MElement | string;

const m = (
  tag: string,
  attrs: Record<string, string> = {},
  children: MChild[] = []
): MElement => ({ tag, attrs, children });

const mi = (text: string, attrs: Record<string, string> = {}) =>
  m('mi', attrs, [text]);
const mo = (text: string, attrs: Record<string, string> = {}) =>
  m('mo', attrs, [text]);

const OPENING = new Set(['(', '[', '{', '⟨', '⌊', '⌈']);
const CLOSING = new Set([')', ']', '}', '⟩', '⌋', '⌉']);

/**
 * A typed operator. Brackets are TeX's Open/Close atoms: no space around
 * them wherever they sit in the row (MathML would infer "infix" mid-row and
 * add thick spaces), and no stretching unless \left/\right asked for it.
 */
function plainMo(text: string): MElement {
  if (OPENING.has(text)) return mo(text, { form: 'prefix', stretchy: 'false' });
  if (CLOSING.has(text))
    return mo(text, { form: 'postfix', stretchy: 'false' });
  return mo(text);
}

/** U+2061 FUNCTION APPLICATION, between a function name and its argument. */
const APPLY = '⁡';

export interface MathLabel {
  key: string;
  range: Range;
}

export interface MathResult {
  /** <math>, with displaystyle="true" for displays. */
  math: MElement;
  diagnostics: Diagnostic[];
  /** \label commands found (equation numbering is the caller's job). */
  labels: MathLabel[];
  /** \nonumber or \notag was used. */
  nonumber: boolean;
  /** \tag{…} text, if any. */
  tag?: string;
}

type Token =
  { kind: 'char'; c: string; range: Range } | { kind: 'node'; node: Node };

/** Math ignores spaces and comments; text splits into one token per character. */
function tokenize(nodes: Node[]): Token[] {
  const out: Token[] = [];
  for (const n of nodes) {
    if (n.kind === 'space' || n.kind === 'comment' || n.kind === 'parbreak')
      continue;
    if (n.kind === 'text') {
      [...n.value].forEach((c, i) =>
        out.push({
          kind: 'char',
          c,
          range: { start: n.range.start + i, end: n.range.start + i + 1 },
        })
      );
    } else out.push({ kind: 'node', node: n });
  }
  return out;
}

/** The plain text of nodes, for \text, \operatorname and \tag. */
function plain(nodes: Node[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.value;
        case 'space':
          return ' ';
        case 'special':
          return n.char === '~' ? ' ' : n.char;
        case 'group':
          return plain(n.children);
        case 'command':
          return n.args.length
            ? n.args
                .filter((a) => !a.optional)
                .map((a) => plain(a.children))
                .join('')
            : (SYMBOL_TEXT[n.name] ?? '');
        case 'math':
          return n.source;
        default:
          return '';
      }
    })
    .join('');
}

const SYMBOL_TEXT: Record<string, string> = {
  '%': '%',
  $: '$',
  '&': '&',
  '#': '#',
  _: '_',
  '{': '{',
  '}': '}',
  ' ': ' ',
};

/** One translated item, with what the script logic needs to know. */
interface Atom {
  el: MElement;
  /** Scripts go above/below (∑, lim, \overbrace) rather than to the side. */
  limits?: boolean;
  /** Emit U+2061 after the (scripted) item: \sin, \log … */
  apply?: boolean;
}

class Translator {
  diagnostics: Diagnostic[] = [];
  labels: MathLabel[] = [];
  nonumber = false;
  tag?: string;

  warn(range: Range, message: string) {
    this.diagnostics.push({
      range,
      severity: 'warning',
      code: 'math/unsupported-command',
      message,
      source: 'syntax',
    });
  }

  /** Translate a node list into MathML children. */
  list(nodes: Node[]): MChild[] {
    return this.tokens(tokenize(nodes));
  }

  tokens(toks: Token[]): MChild[] {
    const s = { toks, i: 0 };
    return this.sequence(s, false);
  }

  /**
   * Translate tokens until the end, or (inside \left) until \right, which is
   * left unconsumed.
   */
  sequence(s: State, inLeft: boolean): MChild[] {
    const out: MChild[] = [];
    while (s.i < s.toks.length) {
      const t = s.toks[s.i];
      if (t.kind === 'node' && t.node.kind === 'command') {
        const name = t.node.name;
        if (name === 'right' && inLeft) return out;
        if (name === 'displaystyle' || name === 'textstyle') {
          s.i++;
          out.push(
            m(
              'mstyle',
              { displaystyle: String(name === 'displaystyle') },
              this.sequence(s, inLeft)
            )
          );
          return out;
        }
      }
      const startsScript =
        t.kind === 'node' &&
        t.node.kind === 'special' &&
        (t.node.char === '^' || t.node.char === '_');
      // A script with nothing before it has an empty base, as in TeX.
      const atom = startsScript ? { el: m('mrow') } : this.atom(s);
      if (!atom) continue;
      out.push(...this.scripts(s, atom));
    }
    return out;
  }

  /** Attach any primes, ^ and _ that follow `atom`. */
  scripts(s: State, atom: Atom): MChild[] {
    let sub: MChild | undefined;
    let sup: MChild | undefined;
    let primes = 0;
    for (;;) {
      const t = s.toks[s.i];
      if (t?.kind === 'char' && t.c === "'") {
        primes++;
        s.i++;
      } else if (
        t?.kind === 'node' &&
        t.node.kind === 'special' &&
        (t.node.char === '^' || t.node.char === '_')
      ) {
        s.i++;
        const arg = this.argument(s);
        if (t.node.char === '^') sup = arg;
        else sub = arg;
      } else if (
        t?.kind === 'node' &&
        t.node.kind === 'command' &&
        (t.node.name === 'limits' || t.node.name === 'nolimits')
      ) {
        s.i++;
        atom.el.attrs.movablelimits = 'false';
        atom.limits = t.node.name === 'limits';
      } else break;
    }
    if (primes) {
      const prime = mo(['′', '″', '‴', '⁗'][Math.min(primes, 4) - 1]);
      sup = sup ? m('mrow', {}, [prime, sup]) : prime;
    }
    let el: MElement = atom.el;
    if (sub || sup) {
      const [one, both, under, over] = atom.limits
        ? ['munder', 'munderover', 'munder', 'mover']
        : ['msub', 'msubsup', 'msub', 'msup'];
      // Limits get TeX's \bigopspacing5 kern above/below in displays, which
      // the OpenType MATH table lacks (document CSS, class "limits").
      const attrs: Record<string, string> = atom.limits
        ? { class: 'limits' }
        : {};
      if (sub && sup) el = m(both, attrs, [el, sub, sup]);
      else if (sub) el = m(atom.limits ? under : one, attrs, [el, sub]);
      else el = m(over, attrs, [el, sup!]);
    }
    return atom.apply ? [el, mo(APPLY)] : [el];
  }

  /** One argument for ^, _ or a command: a group, or a single token. */
  argument(s: State): MChild {
    const nodes = this.argumentNodes(s);
    return wrap(this.list(nodes));
  }

  /** The nodes of the next argument (a group's children, or one token). */
  argumentNodes(s: State): Node[] {
    const t = s.toks[s.i++];
    if (!t) return [];
    if (t.kind === 'char')
      return [{ kind: 'text', value: t.c, range: t.range }];
    return t.node.kind === 'group' ? t.node.children : [t.node];
  }

  /** Mandatory argument `n` of a command: parsed, or the next token. */
  arg(s: State, c: CommandNode, n: number): Node[] {
    const mandatory = c.args.filter((a) => !a.optional);
    return mandatory[n]?.children ?? this.argumentNodes(s);
  }

  atom(s: State): Atom | null {
    const t = s.toks[s.i++];
    if (t.kind === 'char') return this.char(s, t);
    const n = t.node;
    switch (n.kind) {
      case 'group':
        return { el: wrapEl(this.list(n.children)) };
      case 'special':
        // & and ~ outside an alignment: TeX would complain; show a space.
        return n.char === '~'
          ? { el: m('mspace', { width: '0.3333em' }) }
          : null;
      case 'command':
        return this.command(s, n);
      case 'environment':
        return { el: this.environment(n) };
      case 'math':
        return { el: wrapEl(this.list(n.children)) };
      default:
        return null;
    }
  }

  char(s: State, t: { c: string; range: Range }): Atom {
    const c = t.c;
    if (/\d/.test(c)) {
      let num = c;
      // A number: digits, with a decimal point between digits.
      for (;;) {
        const next = s.toks[s.i];
        const after = s.toks[s.i + 1];
        if (next?.kind === 'char' && /\d/.test(next.c)) num += next.c;
        else if (
          next?.kind === 'char' &&
          next.c === '.' &&
          after?.kind === 'char' &&
          /\d/.test(after.c)
        )
          num += '.';
        else break;
        s.i++;
      }
      return { el: m('mn', {}, [num]) };
    }
    if (OPERATORS[c] !== undefined) return { el: plainMo(OPERATORS[c]) };
    return { el: mi(c) };
  }

  command(s: State, c: CommandNode): Atom | null {
    const name = c.name;
    const range = c.nameRange ?? c.range;
    // The parser gives unknown commands every following {…} group as an
    // argument: groups beyond this command's arity go back into the stream.
    const mandatory = c.args.filter((a) => !a.optional);
    const arity = ARITY[name] ?? (ACCENTS[name] ? 1 : 0);
    if (mandatory.length > arity) {
      const extra = mandatory.slice(arity).map((a): Token => ({
        kind: 'node',
        node: { kind: 'group', children: a.children, range: a.range },
      }));
      s.toks.splice(s.i, 0, ...extra);
      c = {
        ...c,
        args: c.args.filter(
          (a) => a.optional || !mandatory.slice(arity).includes(a)
        ),
      };
    }

    // Bookkeeping for numbered displays.
    switch (name) {
      case 'label':
        this.labels.push({
          key: plain(this.arg(s, c, 0)).trim(),
          range: c.range,
        });
        return null;
      case 'nonumber':
      case 'notag':
        this.nonumber = true;
        return null;
      case 'tag':
      case 'tag*':
        this.tag = plain(this.arg(s, c, 0)).trim();
        return null;
    }

    if (ORDINARY[name] !== undefined) {
      const [text, upright] = ORDINARY[name];
      return { el: mi(text, upright ? { mathvariant: 'normal' } : {}) };
    }
    if (DELIMITERS[name] !== undefined)
      return { el: plainMo(DELIMITERS[name]) };
    if (OPERATORS[`\\${name}`] !== undefined)
      return { el: plainMo(OPERATORS[`\\${name}`]) };
    if (BIG_OPERATORS[name] !== undefined) {
      const [text, limits] = BIG_OPERATORS[name];
      return { el: mo(text), limits };
    }
    if (FUNCTIONS.has(name)) return { el: mi(name), apply: true };
    if (LIMIT_FUNCTIONS[name] !== undefined)
      return { el: mi(LIMIT_FUNCTIONS[name]), limits: true };
    if (SPACES[name] !== undefined)
      return { el: m('mspace', { width: SPACES[name] }) };
    if (BIG_DELIMITER_SIZES[name.replace(/[lrm]$/, '')] !== undefined) {
      const size = BIG_DELIMITER_SIZES[name.replace(/[lrm]$/, '')];
      return {
        el: mo(this.delimiter(s), { minsize: size, maxsize: size }),
      };
    }
    if (ACCENTS[name] !== undefined) {
      const [mark, stretchy, under] = ACCENTS[name];
      const base = wrap(this.list(this.arg(s, c, 0)));
      const accent = mo(mark, stretchy ? { stretchy: 'true' } : {});
      return under
        ? { el: m('munder', { accentunder: 'true' }, [base, accent]) }
        : { el: m('mover', { accent: 'true' }, [base, accent]) };
    }

    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac': {
        const frac = m('mfrac', {}, [
          wrap(this.list(this.arg(s, c, 0))),
          wrap(this.list(this.arg(s, c, 1))),
        ]);
        return {
          el:
            name === 'dfrac' || name === 'cfrac'
              ? m('mstyle', { displaystyle: 'true' }, [frac])
              : name === 'tfrac'
                ? m('mstyle', { displaystyle: 'false' }, [frac])
                : frac,
        };
      }
      case 'binom':
      case 'dbinom':
      case 'tbinom':
        return {
          el: m('mrow', {}, [
            mo('('),
            m('mfrac', { linethickness: '0' }, [
              wrap(this.list(this.arg(s, c, 0))),
              wrap(this.list(this.arg(s, c, 1))),
            ]),
            mo(')'),
          ]),
        };
      case 'sqrt': {
        const index = c.args.find((a) => a.optional);
        const base = wrap(this.list(this.arg(s, c, 0)));
        return {
          el: index
            ? m('mroot', {}, [base, wrap(this.list(index.children))])
            : m('msqrt', {}, base.tag === 'mrow' ? base.children : [base]),
        };
      }
      case 'left':
        return { el: this.fenced(s) };
      case 'middle':
        return { el: mo(this.delimiter(s), { stretchy: 'true' }) };
      case 'right':
        // A \right without \left: show the delimiter.
        return { el: mo(this.delimiter(s)) };
      case 'text':
      case 'textrm':
      case 'textnormal':
      case 'textit':
      case 'textbf':
      case 'textsf':
      case 'texttt':
      case 'mbox':
      case 'hbox':
        return {
          el: m('mtext', {}, [plain(this.arg(s, c, 0)).replace(/ /g, ' ')]),
        };
      case 'operatorname':
        return { el: mi(plain(this.arg(s, c, 0)).trim()), apply: true };
      case 'mathrm':
      case 'mathup':
        return { el: wrapEl(this.upright(this.arg(s, c, 0))) };
      case 'mathbf':
      case 'mathit':
      case 'mathbb':
      case 'mathcal':
      case 'mathscr':
      case 'mathfrak':
      case 'mathsf':
      case 'mathtt':
      case 'boldsymbol':
      case 'bm':
        return {
          el: wrapEl(
            this.list(this.arg(s, c, 0)).map((x) => restyle(x, ALPHABETS[name]))
          ),
        };
      case 'overset':
      case 'stackrel':
      case 'underset': {
        const script = wrap(this.list(this.arg(s, c, 0)));
        const base = wrap(this.list(this.arg(s, c, 1)));
        return {
          el: m(name === 'underset' ? 'munder' : 'mover', {}, [base, script]),
        };
      }
      case 'overbrace':
      case 'underbrace':
        return {
          el: m(name === 'overbrace' ? 'mover' : 'munder', {}, [
            wrap(this.list(this.arg(s, c, 0))),
            mo(name === 'overbrace' ? '⏞' : '⏟', { stretchy: 'true' }),
          ]),
          limits: true,
        };
      case 'not': {
        const next = this.atom(s);
        const text = next?.el.children[0];
        return typeof text === 'string'
          ? { el: mo(NEGATED[text] ?? `${text}̸`) }
          : { el: mo('/') };
      }
    }

    this.warn(range, `\\${name} is not supported in math by the emulator.`);
    return { el: m('merror', {}, [m('mtext', {}, [`\\${name}`])]) };
  }

  /** The delimiter after \left, \right, \middle or \big…: a character or a command. */
  delimiter(s: State): string {
    const t = s.toks[s.i++];
    if (!t) return '';
    if (t.kind === 'char') return t.c === '.' ? '' : (OPERATORS[t.c] ?? t.c);
    if (t.node.kind === 'command')
      return DELIMITERS[t.node.name] ?? SYMBOL_TEXT[t.node.name] ?? '';
    return '';
  }

  /** \left X … \right Y */
  fenced(s: State): MElement {
    const open = this.delimiter(s);
    const inner = this.sequence(s, true);
    let close = '';
    const t = s.toks[s.i];
    if (
      t?.kind === 'node' &&
      t.node.kind === 'command' &&
      t.node.name === 'right'
    ) {
      s.i++;
      close = this.delimiter(s);
    }
    const fence = (d: string) => mo(d, { fence: 'true', stretchy: 'true' });
    return m('mrow', {}, [
      ...(open ? [fence(open)] : []),
      ...inner,
      ...(close ? [fence(close)] : []),
    ]);
  }

  /** \mathrm: letters upright, adjacent letters one identifier. */
  upright(nodes: Node[]): MChild[] {
    const out: MChild[] = [];
    for (const x of this.list(nodes)) {
      const prev = out.at(-1);
      if (
        isLetterMi(x) &&
        prev &&
        typeof prev !== 'string' &&
        prev.tag === 'mi' &&
        prev.attrs.joinable
      )
        prev.children[0] += x.children[0] as string;
      else if (isLetterMi(x))
        out.push(mi(x.children[0] as string, { joinable: 'yes' }));
      else out.push(x);
    }
    for (const x of out)
      if (typeof x !== 'string' && x.attrs.joinable) {
        delete x.attrs.joinable;
        if ((x.children[0] as string).length === 1)
          x.attrs.mathvariant = 'normal';
      }
    return out;
  }

  environment(env: EnvironmentNode): MElement {
    let body = env.children;
    let spec = env.args.find((a) => !a.optional)?.children;
    // \begin{array}{lcr}: the parser leaves the column spec in the body.
    if (env.name === 'array' && !spec) {
      const first = body.findIndex(
        (n) => n.kind !== 'space' && n.kind !== 'comment'
      );
      if (body[first]?.kind === 'group') {
        spec = (body[first] as { children: Node[] }).children;
        body = body.slice(first + 1);
      }
    }
    const rows = alignmentRows(body);
    for (const r of rows) {
      this.labels.push(...r.labels);
      if (r.tag !== undefined) this.tag = r.tag;
    }
    const align =
      env.name === 'cases'
        ? ['left', 'left']
        : env.name === 'array' && spec
          ? [...plain(spec)]
              .filter((ch) => 'lcr'.includes(ch))
              .map(
                (ch) =>
                  ({ l: 'left', c: 'center', r: 'right' })[
                    ch as 'l' | 'c' | 'r'
                  ]
              )
          : ['aligned', 'split', 'alignedat'].includes(env.name)
            ? ['right', 'left']
            : null;
    const attrs: Record<string, string> = {};
    if (align) {
      const cols = Math.max(...rows.map((r) => r.cells.length), 1);
      attrs.columnalign = Array.from(
        { length: cols },
        (_, i) => align[i % align.length]
      ).join(' ');
    }
    if (['aligned', 'split', 'alignedat', 'gathered'].includes(env.name))
      attrs.displaystyle = 'true';
    const table = m(
      'mtable',
      attrs,
      rows.map((r) =>
        m(
          'mtr',
          {},
          r.cells.map((cell) => m('mtd', {}, this.list(cell)))
        )
      )
    );
    const fences = MATRIX_FENCES[env.name];
    if (!fences) {
      if (
        ![
          'matrix',
          'smallmatrix',
          'array',
          'aligned',
          'split',
          'alignedat',
          'gathered',
        ].includes(env.name)
      )
        this.warn(
          env.range,
          `The ${env.name} environment is not supported in math by the emulator.`
        );
      return table;
    }
    const [open, close] = fences;
    return m('mrow', {}, [
      ...(open ? [mo(open)] : []),
      table,
      ...(close ? [mo(close)] : []),
    ]);
  }
}

interface State {
  toks: Token[];
  i: number;
}

/** Mandatory arguments of math commands (accents take one). */
const ARITY: Record<string, number> = {
  frac: 2,
  dfrac: 2,
  tfrac: 2,
  cfrac: 2,
  binom: 2,
  dbinom: 2,
  tbinom: 2,
  sqrt: 1,
  overset: 2,
  underset: 2,
  stackrel: 2,
  overbrace: 1,
  underbrace: 1,
  text: 1,
  textrm: 1,
  textnormal: 1,
  textit: 1,
  textbf: 1,
  textsf: 1,
  texttt: 1,
  mbox: 1,
  hbox: 1,
  operatorname: 1,
  mathrm: 1,
  mathup: 1,
  mathbf: 1,
  mathit: 1,
  mathbb: 1,
  mathcal: 1,
  mathscr: 1,
  mathfrak: 1,
  mathsf: 1,
  mathtt: 1,
  boldsymbol: 1,
  bm: 1,
  label: 1,
  tag: 1,
  'tag*': 1,
};

const NEGATED: Record<string, string> = {
  '=': '≠',
  '∈': '∉',
  '≤': '≰',
  '≥': '≱',
  '⊂': '⊄',
  '⊆': '⊈',
  '≡': '≢',
  '∼': '≁',
  '≈': '≉',
};

const ALPHABETS: Record<string, Alphabet> = {
  mathbf: 'bold',
  mathit: 'italic',
  mathbb: 'double-struck',
  mathcal: 'script',
  mathscr: 'script',
  mathfrak: 'fraktur',
  mathsf: 'sans-serif',
  mathtt: 'monospace',
  boldsymbol: 'bold-italic',
  bm: 'bold-italic',
};

function isLetterMi(x: MChild): x is MElement {
  return (
    typeof x !== 'string' &&
    x.tag === 'mi' &&
    typeof x.children[0] === 'string' &&
    /^[A-Za-z]$/.test(x.children[0])
  );
}

/** Map identifiers and numbers into a Unicode mathematical alphabet. */
function restyle(x: MChild, alphabet: Alphabet): MChild {
  if (typeof x === 'string') return x;
  if ((x.tag === 'mi' || x.tag === 'mn') && typeof x.children[0] === 'string') {
    const text = [...x.children[0]]
      .map((ch) => mapAlphabet(ch, alphabet))
      .join('');
    const attrs = { ...x.attrs };
    delete attrs.mathvariant;
    return m(x.tag, attrs, [text]);
  }
  return m(
    x.tag,
    x.attrs,
    x.children.map((c) => restyle(c, alphabet))
  );
}

function wrap(children: MChild[]): MElement {
  return children.length === 1 && typeof children[0] !== 'string'
    ? children[0]
    : m('mrow', {}, children);
}
const wrapEl = wrap;

export function mathToMathML(
  nodes: Node[],
  { display }: { display: boolean }
): MathResult {
  const t = new Translator();
  const children = t.list(nodes);
  return {
    math: m('math', display ? { displaystyle: 'true' } : {}, children),
    diagnostics: t.diagnostics,
    labels: t.labels,
    nonumber: t.nonumber,
    tag: t.tag,
  };
}

export interface AlignmentRow {
  /** Cells between & separators, as nodes. */
  cells: Node[][];
  labels: MathLabel[];
  /** Gets an automatic number (no \nonumber, \notag or \tag). */
  numbered: boolean;
  tag?: string;
}

/** Split an alignment body into rows (at \\) and cells (at &). */
export function alignmentRows(nodes: Node[]): AlignmentRow[] {
  const rows: AlignmentRow[] = [];
  let row: AlignmentRow = { cells: [[]], labels: [], numbered: true };
  const blank = (r: AlignmentRow) =>
    r.cells.every((cell) =>
      cell.every(
        (n) =>
          n.kind === 'space' || n.kind === 'comment' || n.kind === 'parbreak'
      )
    );
  for (const n of nodes) {
    if (n.kind === 'special' && n.char === '&') {
      row.cells.push([]);
      continue;
    }
    if (n.kind === 'command') {
      if (n.name === '\\' || n.name === 'cr') {
        rows.push(row);
        row = { cells: [[]], labels: [], numbered: true };
        continue;
      }
      if (n.name === 'label') {
        row.labels.push({
          key: plain(n.args.find((a) => !a.optional)?.children ?? []).trim(),
          range: n.range,
        });
        continue;
      }
      if (n.name === 'nonumber' || n.name === 'notag') {
        row.numbered = false;
        continue;
      }
      if (n.name === 'tag' || n.name === 'tag*') {
        row.numbered = false;
        row.tag = plain(n.args.find((a) => !a.optional)?.children ?? []).trim();
        continue;
      }
    }
    row.cells.at(-1)!.push(n);
  }
  if (!blank(row) || rows.length === 0) rows.push(row);
  return rows;
}
