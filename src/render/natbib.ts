/**
 * natbib citations as LaTeX text, following natbib.sty's behaviour (checked
 * against real pdflatex + natbib): author–year and numerical modes, notes,
 * same-author merging ("1955a,b"), starred and capitalised variants.
 * Without natbib, classic LaTeX numbered citations ("[1, p. 5]").
 */

export interface NatbibOptions {
  open: string;
  close: string;
  /** Between citations: ";" (natbib's default) or ",". */
  sep: string;
  /** Numerical mode (the numbers option, or a numerical \bibpunct). */
  numbers: boolean;
  /** Between author and year: "Odum, 1996". */
  aysep: string;
  /** Between years of the same authors: "1996, 2007". */
  yrsep: string;
}

type Punct = [
  open: string,
  close: string,
  sep: string,
  mode: string,
  aysep: string,
  yrsep: string,
];

/** natbib.sty's \bibstyle@<name> table, applied by \bibliographystyle. */
const BIBSTYLES: Record<string, Punct> = {
  chicago: ['(', ')', ';', 'a', ',', ','],
  named: ['[', ']', ';', 'a', ',', ','],
  agu: ['[', ']', ';', 'a', ',', ',~'],
  copernicus: ['(', ')', ';', 'a', ',', ','],
  egu: ['(', ')', ';', 'a', ',', ','],
  egs: ['(', ')', ';', 'a', ',', ','],
  agsm: ['(', ')', ',', 'a', '', ','],
  kluwer: ['(', ')', ',', 'a', '', ','],
  dcu: ['(', ')', ';', 'a', ';', ','],
  aa: ['(', ')', ';', 'a', '', ','],
  pass: ['(', ')', ';', 'a', ',', ','],
  anngeo: ['(', ')', ';', 'a', ',', ','],
  nlinproc: ['(', ')', ';', 'a', ',', ','],
  plain: ['[', ']', ',', 'n', '', ','],
  alpha: ['[', ']', ',', 'n', '', ','],
  abbrv: ['[', ']', ',', 'n', '', ','],
  unsrt: ['[', ']', ',', 'n', '', ','],
  plainnat: ['[', ']', ',', 'a', ',', ','],
  abbrvnat: ['[', ']', ',', 'a', ',', ','],
  unsrtnat: ['[', ']', ',', 'a', ',', ','],
};

/**
 * natbib's punctuation from its package options and the bibliography style,
 * as natbib.sty computes it: options run in declaration order (not the
 * order given), and any punctuation option disables the style's \bibpunct.
 */
export function natbibOptions(
  options: string[],
  style?: string
): NatbibOptions {
  const o: NatbibOptions = {
    open: '(',
    close: ')',
    sep: ';',
    numbers: false,
    aysep: ',',
    yrsep: ',',
  };
  let bibstyle = true;
  const given = new Set(options);
  const run: Record<string, () => void> = {
    numbers: () => {
      o.numbers = true;
      run.square();
      run.comma();
    },
    authoryear: () => {
      o.numbers = false;
      run.round();
      run.semicolon();
      bibstyle = true;
    },
    round: () => {
      [o.open, o.close] = ['(', ')'];
      bibstyle = false;
    },
    square: () => {
      [o.open, o.close] = ['[', ']'];
      bibstyle = false;
    },
    angle: () => {
      [o.open, o.close] = ['$<$', '$>$'];
      bibstyle = false;
    },
    curly: () => {
      [o.open, o.close] = ['\\{', '\\}'];
      bibstyle = false;
    },
    comma: () => {
      o.sep = ',';
      bibstyle = false;
    },
    semicolon: () => {
      o.sep = ';';
      bibstyle = false;
    },
    colon: () => run.semicolon(),
  };
  for (const name of Object.keys(run)) if (given.has(name)) run[name]();
  const punct = style !== undefined && bibstyle ? BIBSTYLES[style] : undefined;
  if (punct) {
    [o.open, o.close, o.sep] = punct;
    o.numbers = punct[3] === 'n';
    [o.aysep, o.yrsep] = [punct[4], punct[5]];
  }
  return o;
}

export interface BibLabel {
  key: string;
  /** 1-based position in the bibliography. */
  number: number;
  /** LaTeX: "Hall et~al." */
  short: string;
  /** LaTeX: "2014" or "1955{\natexlab{a}}" */
  year: string;
  /** LaTeX: "Hall, Lambert, and Balogh" (or short when not given). */
  long: string;
  /** The label has no author–year form ([label] missing or not "a(y)b"). */
  numeric: boolean;
  /** What classic LaTeX prints: the [label] as given, or the number. */
  text: string;
}

/** Split a natbib \bibitem label "Short(Year)Long" (at brace level 0). */
export function parseBibitemLabel(
  label: string | undefined,
  key: string,
  number: number
): BibLabel {
  const numeric = (): BibLabel => ({
    key,
    number,
    short: label ?? String(number),
    year: '',
    long: label ?? String(number),
    numeric: true,
    text: label ?? String(number),
  });
  if (label === undefined) return numeric();
  let depth = 0;
  let open = -1;
  let close = -1;
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && c === '(' && open === -1) open = i;
    else if (depth === 0 && c === ')' && open !== -1) {
      close = i;
      break;
    }
  }
  if (open === -1 || close === -1) return numeric();
  const short = label.slice(0, open);
  const long = label.slice(close + 1);
  return {
    key,
    number,
    short,
    year: label.slice(open + 1, close),
    long: long || short,
    numeric: false,
    text: label,
  };
}

export type CitationMode = 'natbib' | 'classic';

export interface CitationRequest {
  /** Command name, e.g. "citep", "Citet", "cite". */
  command: string;
  star: boolean;
  /** Optional arguments as LaTeX: one → [post], two → [pre][post]. */
  notes: string[];
  keys: string[];
}

export interface CitationResult {
  latex: string;
  undefinedKeys: string[];
}

const UNDEFINED = '\\textbf{?}';
/** natbib's markers for a label without an author or a year. */
const NO_AUTHOR = '\\textbf{(author?)}';
const NO_YEAR = '\\textbf{(year?)}';

function splitYear(year: string): { base: string; suffix: string | null } {
  const m = /^(.*)\{\\natexlab\{([^{}]*)\}\}$/.exec(year);
  return m ? { base: m[1], suffix: m[2] } : { base: year, suffix: null };
}

/** Upper-case the first letter (natbib's \Citet …). */
function capitalise(s: string): string {
  return s.replace(/[A-Za-z]/, (c) => c.toUpperCase());
}

export function formatCitation(
  req: CitationRequest,
  labels: Map<string, BibLabel>,
  mode: CitationMode,
  opts: NatbibOptions
): CitationResult {
  const undefinedKeys: string[] = [];
  const found = req.keys.map((k) => {
    const label = labels.get(k.toLowerCase());
    if (!label) undefinedKeys.push(k);
    return label;
  });
  const [pre, post] =
    req.notes.length >= 2
      ? [req.notes[0], req.notes[1]]
      : ['', req.notes[0] ?? ''];
  const withNotes = (s: string) =>
    `${pre ? `${pre} ` : ''}${s}${post ? `, ${post}` : ''}`;
  const result = (latex: string): CitationResult => ({ latex, undefinedKeys });

  // Classic LaTeX: \cite[note]{a,b} → [label, label, note].
  if (mode === 'classic')
    return result(
      `[${withNotes(found.map((l) => (l ? l.text : UNDEFINED)).join(', '))}]`
    );

  const sep = `${opts.sep} `;
  const name = req.command.toLowerCase();
  const capital = req.command.startsWith('C');
  const author = (l: BibLabel, first: boolean) => {
    if (l.numeric) return NO_AUTHOR;
    const a = req.star || name === 'citefullauthor' ? l.long : l.short;
    return capital && first ? capitalise(a) : a;
  };
  const year = (l: BibLabel) => (l.numeric ? NO_YEAR : l.year);
  const { open, close } = opts;

  if (opts.numbers) {
    const num = (l: BibLabel) => (l.numeric ? l.short : String(l.number));
    const nums = found.map((l) => (l ? num(l) : UNDEFINED)).join(sep);
    switch (name) {
      case 'citenum':
        return result(nums);
      case 'citealp':
        return result(withNotes(nums));
      case 'citet':
      case 'citealt': {
        const parts = found.map((l, i) => {
          if (!l) return UNDEFINED;
          const n =
            i === found.length - 1 && post ? `${num(l)}, ${post}` : num(l);
          return name === 'citet'
            ? `${author(l, i === 0)} ${open}${n}${close}`
            : `${author(l, i === 0)} ${n}`;
        });
        return result(parts.join(sep));
      }
    }
    // Everything else is shared with author–year mode below, except
    // \citep and \cite, which give the bracketed numbers.
    if (name === 'citep' || name === 'cite')
      return result(`${open}${withNotes(nums)}${close}`);
  }

  /** Author–year groups: consecutive citations of the same authors merge. */
  const items: ({ label: BibLabel; years: string } | null)[] = [];
  for (const l of found) {
    const last = items.at(-1);
    if (!l || !last || l.numeric || last.label.short !== l.short) {
      items.push(l ? { label: l, years: year(l) } : null);
      continue;
    }
    const a = splitYear(last.label.year);
    const b = splitYear(l.year);
    last.years +=
      a.base === b.base && a.suffix !== null && b.suffix !== null
        ? `,${b.suffix}`
        : `${opts.yrsep} ${l.year}`;
    last.label = { ...last.label, year: l.year };
  }
  const each = (
    f: (g: { label: BibLabel; years: string }, i: number) => string
  ) => items.map((g, i) => (g ? f(g, i) : UNDEFINED)).join(sep);
  const ay = (g: { label: BibLabel; years: string }, i: number) =>
    `${author(g.label, i === 0)}${opts.aysep} ${g.years}`;

  switch (name) {
    case 'citeauthor':
    case 'citefullauthor':
      return result(each((g, i) => author(g.label, i === 0)));
    case 'citeyear':
      return result(each((g) => g.years));
    case 'citeyearpar':
      return result(`${open}${withNotes(each((g) => g.years))}${close}`);
    case 'citep':
      return result(`${open}${withNotes(each(ay))}${close}`);
    case 'citealp':
      return result(withNotes(each(ay)));
    case 'citealt':
      return result(
        withNotes(each((g, i) => `${author(g.label, i === 0)} ${g.years}`))
      );
    default: {
      // \citet, and \cite in author–year mode.
      const last = items.length - 1;
      return result(
        each((g, i) => {
          let years = g.years;
          if (i === 0 && pre) years = `${pre} ${years}`;
          if (i === last && post) years = `${years}, ${post}`;
          return `${author(g.label, i === 0)} ${open}${years}${close}`;
        })
      );
    }
  }
}
