/**
 * A BibTeX emulator: runs a .bst style program over a .bib database and
 * produces the .bbl text real bibtex would write (see ADR 0007). Pure TS.
 */
import { parseBib } from './bib-parser.ts';
import type { BibEntry } from './bib-parser.ts';
import { formatName, numNames } from './names.ts';
import {
  addPeriod,
  changeCase,
  isWhite,
  purify,
  substring,
  textLength,
  textPrefix,
} from './text.ts';

export interface BibtexInput {
  /** The .bst style source. */
  bst: string;
  /** The .bib database source. */
  bib: string;
  /** Cited keys in order of first citation; "*" cites everything. */
  citations: string[];
}

export interface BibtexResult {
  bbl: string;
  warnings: string[];
}

// ------------------------------------------------------------------ .bst

type Instr =
  | { kind: 'int'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'quote'; name: string }
  | { kind: 'call'; name: string }
  | { kind: 'block'; body: Instr[] };

type Command =
  | { cmd: 'entry'; fields: string[]; ints: string[]; strs: string[] }
  | { cmd: 'integers' | 'strings'; names: string[] }
  | { cmd: 'macro'; name: string; value: string }
  | { cmd: 'function'; name: string; body: Instr[] }
  | { cmd: 'execute' | 'iterate' | 'reverse'; name: string }
  | { cmd: 'read' | 'sort' };

class BstReader {
  src: string;
  pos = 0;
  constructor(src: string) {
    this.src = src;
  }

  skip() {
    for (;;) {
      while (this.pos < this.src.length && /\s/.test(this.src[this.pos]))
        this.pos++;
      if (this.src[this.pos] === '%') {
        while (this.pos < this.src.length && this.src[this.pos] !== '\n')
          this.pos++;
      } else return;
    }
  }

  word(): string {
    this.skip();
    const start = this.pos;
    while (this.pos < this.src.length && !/[\s{}%]/.test(this.src[this.pos]))
      this.pos++;
    return this.src.slice(start, this.pos);
  }

  /** The raw text of a {…} group (without the outer braces). */
  group(): string {
    this.skip();
    if (this.src[this.pos] !== '{')
      throw new Error(`Expected { at ${this.pos}`);
    let depth = 0;
    const start = this.pos + 1;
    for (; this.pos < this.src.length; this.pos++) {
      if (this.src[this.pos] === '{') depth++;
      else if (this.src[this.pos] === '}' && --depth === 0) break;
    }
    return this.src.slice(start, this.pos++);
  }

  names(): string[] {
    return this.group()
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n.toLowerCase());
  }

  /** Function body tokens. */
  body(): Instr[] {
    this.skip();
    if (this.src[this.pos] !== '{')
      throw new Error(`Expected { at ${this.pos}`);
    this.pos++;
    const out: Instr[] = [];
    for (;;) {
      this.skip();
      const c = this.src[this.pos];
      if (c === undefined) throw new Error('Unterminated function body');
      if (c === '}') {
        this.pos++;
        return out;
      }
      if (c === '{') {
        out.push({ kind: 'block', body: this.body() });
      } else if (c === '"') {
        const end = this.src.indexOf('"', this.pos + 1);
        out.push({ kind: 'str', value: this.src.slice(this.pos + 1, end) });
        this.pos = end + 1;
      } else if (c === '#') {
        this.pos++;
        const w = this.word();
        out.push({ kind: 'int', value: parseInt(w, 10) });
      } else if (c === "'") {
        this.pos++;
        out.push({ kind: 'quote', name: this.word().toLowerCase() });
      } else {
        out.push({ kind: 'call', name: this.word().toLowerCase() });
      }
    }
  }

  commands(): Command[] {
    const out: Command[] = [];
    for (;;) {
      this.skip();
      if (this.pos >= this.src.length) return out;
      const word = this.word().toLowerCase();
      switch (word) {
        case 'entry':
          out.push({
            cmd: 'entry',
            fields: this.names(),
            ints: this.names(),
            strs: this.names(),
          });
          break;
        case 'integers':
        case 'strings':
          out.push({ cmd: word, names: this.names() });
          break;
        case 'macro': {
          const name = this.group().trim().toLowerCase();
          const value = this.group().trim().replace(/^"|"$/g, '');
          out.push({ cmd: 'macro', name, value });
          break;
        }
        case 'function': {
          const name = this.group().trim().toLowerCase();
          out.push({ cmd: 'function', name, body: this.body() });
          break;
        }
        case 'execute':
        case 'iterate':
        case 'reverse':
          out.push({ cmd: word, name: this.group().trim().toLowerCase() });
          break;
        case 'read':
        case 'sort':
          out.push({ cmd: word });
          break;
        default:
          throw new Error(`Unknown .bst command "${word}"`);
      }
    }
  }
}

// ------------------------------------------------------------------ VM

const MISSING = Symbol('missing');
interface FnValue {
  fn: Instr[] | string;
}
type Value = number | string | typeof MISSING | FnValue;

interface Entry {
  key: string;
  type: string;
  fields: Map<string, string>;
  ints: Map<string, number>;
  strs: Map<string, string>;
}

const MAX_PRINT_LINE = 79;
const MIN_PRINT_LINE = 3;
const ENT_STR_SIZE = 250;
const GLOB_STR_SIZE = 20000;

/** cmr10 widths BibTeX uses for width$ (only relative values matter). */
const CHAR_WIDTH: Record<string, number> = {
  ' ': 278,
  '!': 278,
  '"': 500,
  '#': 833,
  $: 500,
  '%': 833,
  '&': 778,
  "'": 278,
  '(': 389,
  ')': 389,
  '*': 500,
  '+': 778,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 500,
  ':': 278,
  ';': 278,
  '<': 278,
  '=': 778,
  '>': 472,
  '?': 472,
  '@': 778,
  A: 750,
  B: 708,
  C: 722,
  D: 764,
  E: 681,
  F: 653,
  G: 785,
  H: 750,
  I: 361,
  J: 514,
  K: 778,
  L: 625,
  M: 917,
  N: 750,
  O: 778,
  P: 681,
  Q: 778,
  R: 736,
  S: 556,
  T: 722,
  U: 750,
  V: 750,
  W: 1028,
  X: 750,
  Y: 750,
  Z: 611,
  '[': 278,
  '\\': 500,
  ']': 278,
  '^': 500,
  _: 278,
  '`': 278,
  a: 500,
  b: 556,
  c: 444,
  d: 556,
  e: 444,
  f: 306,
  g: 500,
  h: 556,
  i: 278,
  j: 306,
  k: 528,
  l: 278,
  m: 833,
  n: 556,
  o: 500,
  p: 556,
  q: 528,
  r: 392,
  s: 394,
  t: 389,
  u: 556,
  v: 528,
  w: 722,
  x: 528,
  y: 528,
  z: 444,
  '{': 500,
  '|': 1000,
  '}': 500,
  '~': 500,
};

export function runBibtex({ bst, bib, citations }: BibtexInput): BibtexResult {
  const warnings: string[] = [];
  const commands = new BstReader(bst).commands();

  const functions = new Map<string, Instr[]>();
  const macros = new Map<string, string>();
  let fieldNames: string[] = ['crossref'];
  let entryInts: string[] = [];
  let entryStrs: string[] = ['sort.key$'];
  const globalInts = new Map<string, number>([
    ['entry.max$', ENT_STR_SIZE],
    ['global.max$', GLOB_STR_SIZE],
  ]);
  const globalStrs = new Map<string, string>();

  let entries: Entry[] = [];
  let preamble = '';
  let current: Entry | null = null;
  const stack: Value[] = [];
  const lines: string[] = [];
  let buf = '';

  // -- output, with bibtex's line breaking -------------------------------
  const outputLine = () => {
    let line = buf.replace(/[ \t]+$/, '');
    if (buf.length !== 0 && line.length === 0) {
      buf = '';
      return; // a line of only white space is dropped entirely
    }
    lines.push(line);
    buf = '';
    line = '';
  };
  const write = (s: string) => {
    buf += s;
    while (buf.length > MAX_PRINT_LINE) {
      const end = buf.length;
      let p = MAX_PRINT_LINE;
      while (p >= MIN_PRINT_LINE && !isWhite(buf[p])) p--;
      if (p === MIN_PRINT_LINE - 1) {
        p = MAX_PRINT_LINE + 1;
        while (p < end && !isWhite(buf[p])) p++;
        if (p === end) return; // unbreakable tail
        while (p + 1 < end && isWhite(buf[p + 1])) p++;
      }
      const rest = buf.slice(p + 1);
      buf = buf.slice(0, p);
      outputLine();
      buf = '  ' + rest;
    }
  };

  // -- stack helpers --------------------------------------------------------
  const pop = (): Value => {
    if (stack.length === 0) {
      warnings.push('You attempted to pop an empty stack');
      return 0;
    }
    return stack.pop()!;
  };
  const popInt = (): number => {
    const v = pop();
    return typeof v === 'number' ? v : 0;
  };
  const popStr = (): string => {
    const v = pop();
    return typeof v === 'string' ? v : '';
  };
  const truthy = (v: Value) => typeof v === 'number' && v > 0;

  const lookupVar = (name: string): Value | undefined => {
    if (current) {
      if (fieldNames.includes(name))
        return current.fields.has(name) ? current.fields.get(name)! : MISSING;
      if (current.ints.has(name)) return current.ints.get(name)!;
      if (current.strs.has(name)) return current.strs.get(name)!;
    }
    if (globalInts.has(name)) return globalInts.get(name)!;
    if (globalStrs.has(name)) return globalStrs.get(name)!;
    return undefined;
  };

  const assign = (name: string, value: Value) => {
    if (current && entryInts.includes(name))
      current.ints.set(name, value as number);
    else if (current && entryStrs.includes(name)) {
      const s = String(value);
      current.strs.set(
        name,
        s.length > ENT_STR_SIZE ? s.slice(0, ENT_STR_SIZE) : s
      );
    } else if (globalInts.has(name)) globalInts.set(name, value as number);
    else if (globalStrs.has(name)) {
      const s = String(value);
      globalStrs.set(
        name,
        s.length > GLOB_STR_SIZE ? s.slice(0, GLOB_STR_SIZE) : s
      );
    } else warnings.push(`Can't assign to ${name}`);
  };

  const runFn = (fn: FnValue['fn']) => {
    if (typeof fn === 'string') call(fn);
    else exec(fn);
  };

  const builtins: Record<string, () => void> = {
    '>': () => {
      const b = popInt();
      stack.push(popInt() > b ? 1 : 0);
    },
    '<': () => {
      const b = popInt();
      stack.push(popInt() < b ? 1 : 0);
    },
    '=': () => {
      const b = pop();
      const a = pop();
      stack.push(a === b ? 1 : 0);
    },
    '+': () => {
      const b = popInt();
      stack.push(popInt() + b);
    },
    '-': () => {
      const b = popInt();
      stack.push(popInt() - b);
    },
    '*': () => {
      const b = popStr();
      stack.push(popStr() + b);
    },
    ':=': () => {
      const ref = pop();
      const value = pop();
      if (typeof ref === 'object' && ref !== null && typeof ref.fn === 'string')
        assign(ref.fn, value);
    },
    'add.period$': () => stack.push(addPeriod(popStr())),
    'call.type$': () => {
      if (!current) return;
      call(functions.has(current.type) ? current.type : 'default.type');
    },
    'change.case$': () => {
      const spec = popStr();
      stack.push(changeCase(popStr(), spec));
    },
    'chr.to.int$': () => stack.push(popStr().charCodeAt(0) || 0),
    cite$: () => stack.push(current ? current.key : ''),
    duplicate$: () => {
      const v = pop();
      stack.push(v, v);
    },
    empty$: () => {
      const v = pop();
      stack.push(
        v === MISSING || (typeof v === 'string' && v.trim() === '') ? 1 : 0
      );
    },
    'format.name$': () => {
      const fmt = popStr();
      const n = popInt();
      stack.push(formatName(popStr(), n, fmt));
    },
    if$: () => {
      const elseFn = pop() as FnValue;
      const thenFn = pop() as FnValue;
      runFn(truthy(pop()) ? thenFn.fn : elseFn.fn);
    },
    'int.to.chr$': () => stack.push(String.fromCharCode(popInt())),
    'int.to.str$': () => stack.push(String(popInt())),
    missing$: () => stack.push(pop() === MISSING ? 1 : 0),
    newline$: () => outputLine(),
    'num.names$': () => stack.push(numNames(popStr())),
    pop$: () => void pop(),
    preamble$: () => stack.push(preamble),
    purify$: () => stack.push(purify(popStr())),
    quote$: () => stack.push('"'),
    skip$: () => {},
    stack$: () => {
      stack.length = 0;
    },
    substring$: () => {
      const len = popInt();
      const start = popInt();
      stack.push(substring(popStr(), start, len));
    },
    swap$: () => {
      const b = pop();
      const a = pop();
      stack.push(b, a);
    },
    'text.length$': () => stack.push(textLength(popStr())),
    'text.prefix$': () => {
      const n = popInt();
      stack.push(textPrefix(popStr(), n));
    },
    top$: () => void pop(),
    // The null string for types the style doesn't define (as bibtex).
    type$: () =>
      stack.push(current && functions.has(current.type) ? current.type : ''),
    warning$: () => warnings.push(`Warning--${popStr()}`),
    while$: () => {
      const body = pop() as FnValue;
      const cond = pop() as FnValue;
      for (;;) {
        runFn(cond.fn);
        if (!truthy(pop())) break;
        runFn(body.fn);
      }
    },
    width$: () => {
      let w = 0;
      for (const c of popStr()) w += CHAR_WIDTH[c] ?? 500;
      stack.push(w);
    },
    write$: () => write(popStr()),
  };

  function call(name: string) {
    const builtin = builtins[name];
    if (builtin) return builtin();
    const fn = functions.get(name);
    if (fn) return exec(fn);
    const v = lookupVar(name);
    if (v !== undefined) {
      stack.push(v);
      return;
    }
    warnings.push(`Unknown function or variable "${name}"`);
  }

  function exec(body: Instr[]) {
    for (const ins of body) {
      switch (ins.kind) {
        case 'int':
        case 'str':
          stack.push(ins.value);
          break;
        case 'quote':
          stack.push({ fn: ins.name });
          break;
        case 'block':
          stack.push({ fn: ins.body });
          break;
        case 'call':
          call(ins.name);
      }
    }
  }

  const read = () => {
    const parsed = parseBib(bib, macros);
    warnings.push(...parsed.warnings);
    preamble = parsed.preamble;
    const byKey = new Map(parsed.entries.map((e) => [e.key.toLowerCase(), e]));

    // Citation list: explicit keys in order, then (for *) the rest in .bib order.
    const list: BibEntry[] = [];
    const listed = new Set<string>();
    const add = (e: BibEntry) => {
      const k = e.key.toLowerCase();
      if (listed.has(k)) return;
      listed.add(k);
      list.push(e);
    };
    for (const c of citations) {
      if (c === '*') continue;
      const e = byKey.get(c.toLowerCase());
      if (e) add(e);
      else warnings.push(`Warning--I didn't find a database entry for "${c}"`);
    }
    if (citations.includes('*')) parsed.entries.forEach(add);

    // crossref: inherit missing fields; parents referenced twice are added.
    const refCount = new Map<string, number>();
    for (const e of list) {
      const parentKey = e.fields.get('crossref')?.toLowerCase();
      if (parentKey && byKey.has(parentKey))
        refCount.set(parentKey, (refCount.get(parentKey) ?? 0) + 1);
    }
    for (const [k, count] of refCount) if (count >= 2) add(byKey.get(k)!);

    entries = list.map((e) => {
      const fields = new Map<string, string>();
      for (const f of fieldNames)
        if (e.fields.has(f)) fields.set(f, e.fields.get(f)!);
      const parentKey = e.fields.get('crossref')?.toLowerCase();
      const parent = parentKey ? byKey.get(parentKey) : undefined;
      if (parent) {
        for (const f of fieldNames)
          if (!fields.has(f) && parent.fields.has(f))
            fields.set(f, parent.fields.get(f)!);
        // A parent that won't be printed can't be cross-referenced.
        if (!listed.has(parentKey!)) fields.delete('crossref');
      } else if (parentKey) {
        warnings.push(`Warning--crossref "${parentKey}" not found`);
        fields.delete('crossref');
      }
      return {
        key: e.key,
        type: e.type,
        fields,
        ints: new Map(entryInts.map((n) => [n, 0])),
        strs: new Map(entryStrs.map((n) => [n, ''])),
      };
    });
  };

  for (const c of commands) {
    switch (c.cmd) {
      case 'entry':
        fieldNames = [...c.fields, 'crossref'];
        entryInts = c.ints;
        entryStrs = [...c.strs, 'sort.key$'];
        break;
      case 'integers':
        for (const n of c.names) globalInts.set(n, 0);
        break;
      case 'strings':
        for (const n of c.names) globalStrs.set(n, '');
        break;
      case 'macro':
        macros.set(c.name, c.value);
        break;
      case 'function':
        functions.set(c.name, c.body);
        break;
      case 'read':
        read();
        break;
      case 'execute':
        current = null;
        call(c.name);
        break;
      case 'iterate':
        for (const e of entries) {
          current = e;
          call(c.name);
        }
        current = null;
        break;
      case 'reverse':
        for (const e of [...entries].reverse()) {
          current = e;
          call(c.name);
        }
        current = null;
        break;
      case 'sort':
        entries = entries
          .map((e, i) => ({ e, i }))
          .sort((a, b) => {
            const ka = a.e.strs.get('sort.key$') ?? '';
            const kb = b.e.strs.get('sort.key$') ?? '';
            return ka < kb ? -1 : ka > kb ? 1 : a.i - b.i;
          })
          .map(({ e }) => e);
        break;
    }
  }
  if (buf.length) outputLine();
  return { bbl: lines.map((l) => l + '\n').join(''), warnings };
}
