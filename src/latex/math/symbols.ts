/**
 * The math part of the command registry: what each math command produces.
 * Characters follow the LaTeX/Unicode correspondence of unicode-math
 * (e.g. \epsilon is ϵ U+03F5 and \varepsilon is ε U+03B5, as in plain TeX).
 */

/** Characters typed directly, and \commands, that are operators (<mo>). */
export const OPERATORS: Record<string, string> = {
  '+': '+',
  '-': '−',
  '=': '=',
  '<': '<',
  '>': '>',
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '/': '/',
  '|': '|',
  ',': ',',
  ';': ';',
  ':': ':',
  '!': '!',
  '?': '?',
  '.': '.',
  '*': '∗',
  // Binary operators.
  '\\pm': '±',
  '\\mp': '∓',
  '\\times': '×',
  '\\div': '÷',
  '\\cdot': '⋅',
  '\\ast': '∗',
  '\\star': '⋆',
  '\\circ': '∘',
  '\\bullet': '∙',
  '\\oplus': '⊕',
  '\\ominus': '⊖',
  '\\otimes': '⊗',
  '\\oslash': '⊘',
  '\\odot': '⊙',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\sqcup': '⊔',
  '\\sqcap': '⊓',
  '\\uplus': '⊎',
  '\\vee': '∨',
  '\\lor': '∨',
  '\\wedge': '∧',
  '\\land': '∧',
  '\\setminus': '∖',
  '\\wr': '≀',
  '\\dagger': '†',
  '\\ddagger': '‡',
  '\\amalg': '⨿',
  // Relations.
  '\\leq': '≤',
  '\\le': '≤',
  '\\geq': '≥',
  '\\ge': '≥',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\equiv': '≡',
  '\\approx': '≈',
  '\\cong': '≅',
  '\\sim': '∼',
  '\\simeq': '≃',
  '\\propto': '∝',
  '\\ll': '≪',
  '\\gg': '≫',
  '\\subset': '⊂',
  '\\supset': '⊃',
  '\\subseteq': '⊆',
  '\\supseteq': '⊇',
  '\\in': '∈',
  '\\notin': '∉',
  '\\ni': '∋',
  '\\mid': '∣',
  '\\parallel': '∥',
  '\\perp': '⟂',
  '\\models': '⊨',
  '\\vdash': '⊢',
  '\\dashv': '⊣',
  '\\prec': '≺',
  '\\succ': '≻',
  '\\preceq': '⪯',
  '\\succeq': '⪰',
  '\\doteq': '≐',
  '\\asymp': '≍',
  '\\coloneqq': '≔',
  // Arrows.
  '\\to': '→',
  '\\rightarrow': '→',
  '\\leftarrow': '←',
  '\\gets': '←',
  '\\leftrightarrow': '↔',
  '\\Rightarrow': '⇒',
  '\\Leftarrow': '⇐',
  '\\Leftrightarrow': '⇔',
  '\\iff': '⟺',
  '\\implies': '⟹',
  '\\impliedby': '⟸',
  '\\mapsto': '↦',
  '\\longrightarrow': '⟶',
  '\\longleftarrow': '⟵',
  '\\longleftrightarrow': '⟷',
  '\\Longrightarrow': '⟹',
  '\\Longleftarrow': '⟸',
  '\\longmapsto': '⟼',
  '\\uparrow': '↑',
  '\\downarrow': '↓',
  '\\Uparrow': '⇑',
  '\\Downarrow': '⇓',
  '\\hookrightarrow': '↪',
  '\\hookleftarrow': '↩',
  '\\nearrow': '↗',
  '\\searrow': '↘',
  '\\nwarrow': '↖',
  '\\swarrow': '↙',
  // Logic and punctuation.
  '\\forall': '∀',
  '\\exists': '∃',
  '\\nexists': '∄',
  '\\neg': '¬',
  '\\lnot': '¬',
  '\\ldots': '…',
  '\\dots': '…',
  '\\dotsc': '…',
  '\\dotsb': '⋯',
  '\\cdots': '⋯',
  '\\vdots': '⋮',
  '\\ddots': '⋱',
  '\\colon': ':',
  '\\{': '{',
  '\\}': '}',
  '\\|': '‖',
};

/** Identifiers: [text, upright?]. Lower-case Greek is italic, as in TeX. */
export const ORDINARY: Record<string, [string, boolean]> = {
  alpha: ['α', false],
  beta: ['β', false],
  gamma: ['γ', false],
  delta: ['δ', false],
  epsilon: ['ϵ', false],
  varepsilon: ['ε', false],
  zeta: ['ζ', false],
  eta: ['η', false],
  theta: ['θ', false],
  vartheta: ['ϑ', false],
  iota: ['ι', false],
  kappa: ['κ', false],
  lambda: ['λ', false],
  mu: ['μ', false],
  nu: ['ν', false],
  xi: ['ξ', false],
  pi: ['π', false],
  varpi: ['ϖ', false],
  rho: ['ρ', false],
  varrho: ['ϱ', false],
  sigma: ['σ', false],
  varsigma: ['ς', false],
  tau: ['τ', false],
  upsilon: ['υ', false],
  phi: ['ϕ', false],
  varphi: ['φ', false],
  chi: ['χ', false],
  psi: ['ψ', false],
  omega: ['ω', false],
  Gamma: ['Γ', true],
  Delta: ['Δ', true],
  Theta: ['Θ', true],
  Lambda: ['Λ', true],
  Xi: ['Ξ', true],
  Pi: ['Π', true],
  Sigma: ['Σ', true],
  Upsilon: ['Υ', true],
  Phi: ['Φ', true],
  Psi: ['Ψ', true],
  Omega: ['Ω', true],
  infty: ['∞', true],
  partial: ['∂', false],
  nabla: ['∇', true],
  emptyset: ['∅', true],
  varnothing: ['⌀', true],
  hbar: ['ℏ', false],
  ell: ['ℓ', false],
  Re: ['ℜ', true],
  Im: ['ℑ', true],
  aleph: ['ℵ', true],
  wp: ['℘', true],
  prime: ['′', true],
  angle: ['∠', true],
  triangle: ['△', true],
  top: ['⊤', true],
  bot: ['⊥', true],
  imath: ['ı', false],
  jmath: ['ȷ', false],
  '%': ['%', true],
  $: ['$', true],
  '#': ['#', true],
  '&': ['&', true],
  _: ['_', true],
};

/** Delimiters usable after \left, \right, \big…, or on their own. */
export const DELIMITERS: Record<string, string> = {
  langle: '⟨',
  rangle: '⟩',
  lbrace: '{',
  rbrace: '}',
  lbrack: '[',
  rbrack: ']',
  vert: '|',
  Vert: '‖',
  lvert: '|',
  rvert: '|',
  lVert: '‖',
  rVert: '‖',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  backslash: '\\',
  '{': '{',
  '}': '}',
  '|': '‖',
};

/** Large operators: [character, scripts as limits (above/below)?]. */
export const BIG_OPERATORS: Record<string, [string, boolean]> = {
  sum: ['∑', true],
  prod: ['∏', true],
  coprod: ['∐', true],
  bigcup: ['⋃', true],
  bigcap: ['⋂', true],
  bigoplus: ['⨁', true],
  bigotimes: ['⨂', true],
  bigodot: ['⨀', true],
  biguplus: ['⨄', true],
  bigvee: ['⋁', true],
  bigwedge: ['⋀', true],
  bigsqcup: ['⨆', true],
  int: ['∫', false],
  iint: ['∬', false],
  iiint: ['∭', false],
  oint: ['∮', false],
};

/** Function names set upright, without limits. */
export const FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'log',
  'ln',
  'lg',
  'exp',
  'deg',
  'arg',
  'dim',
  'hom',
  'ker',
]);

/** Function names whose scripts are limits (below in displays). */
export const LIMIT_FUNCTIONS: Record<string, string> = {
  lim: 'lim',
  limsup: 'lim sup',
  liminf: 'lim inf',
  max: 'max',
  min: 'min',
  sup: 'sup',
  inf: 'inf',
  det: 'det',
  gcd: 'gcd',
  Pr: 'Pr',
};

/** Math spacing commands, in em (TeX: 1em = 18mu). */
export const SPACES: Record<string, string> = {
  ',': '0.1667em',
  thinspace: '0.1667em',
  ':': '0.2222em',
  '>': '0.2222em',
  medspace: '0.2222em',
  ';': '0.2778em',
  thickspace: '0.2778em',
  '!': '-0.1667em',
  negthinspace: '-0.1667em',
  ' ': '0.3333em',
  enspace: '0.5em',
  quad: '1em',
  qquad: '2em',
};

/** \big, \Big, \bigg, \Bigg (and their l/r/m forms) → delimiter size. */
export const BIG_DELIMITER_SIZES: Record<string, string> = {
  big: '1.2em',
  Big: '1.8em',
  bigg: '2.4em',
  Bigg: '3em',
};

/** Accents: [mark, stretchy?, under?]. */
export const ACCENTS: Record<string, [string, boolean, boolean]> = {
  hat: ['^', false, false],
  widehat: ['^', true, false],
  check: ['ˇ', false, false],
  tilde: ['~', false, false],
  widetilde: ['~', true, false],
  acute: ['´', false, false],
  grave: ['`', false, false],
  dot: ['˙', false, false],
  ddot: ['¨', false, false],
  breve: ['˘', false, false],
  bar: ['¯', false, false],
  vec: ['→', false, false],
  overline: ['‾', true, false],
  overrightarrow: ['→', true, false],
  overleftarrow: ['←', true, false],
  underline: ['_', true, true],
};

/** Matrix environments: [open, close] fence (empty for none). */
export const MATRIX_FENCES: Record<string, [string, string]> = {
  pmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
  cases: ['{', ''],
};

export type Alphabet =
  | 'bold'
  | 'italic'
  | 'bold-italic'
  | 'double-struck'
  | 'script'
  | 'fraktur'
  | 'sans-serif'
  | 'monospace';

/** First code points of each Unicode mathematical alphabet: [A, a, 0]. */
const STARTS: Record<Alphabet, [number, number, number | null]> = {
  bold: [0x1d400, 0x1d41a, 0x1d7ce],
  italic: [0x1d434, 0x1d44e, null],
  'bold-italic': [0x1d468, 0x1d482, null],
  'double-struck': [0x1d538, 0x1d552, 0x1d7d8],
  script: [0x1d49c, 0x1d4b6, null],
  fraktur: [0x1d504, 0x1d51e, null],
  'sans-serif': [0x1d5a0, 0x1d5ba, 0x1d7e2],
  monospace: [0x1d670, 0x1d68a, 0x1d7f6],
};

/** Letters encoded in the Letterlike Symbols block instead (holes in the alphabets). */
const HOLES: Partial<Record<Alphabet, Record<string, string>>> = {
  italic: { h: 'ℎ' },
  'double-struck': { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
  script: {
    B: 'ℬ',
    E: 'ℰ',
    F: 'ℱ',
    H: 'ℋ',
    I: 'ℐ',
    L: 'ℒ',
    M: 'ℳ',
    R: 'ℛ',
    e: 'ℯ',
    g: 'ℊ',
    o: 'ℴ',
  },
  fraktur: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
};

/** A Latin letter or digit in a mathematical alphabet; anything else unchanged. */
export function mapAlphabet(ch: string, alphabet: Alphabet): string {
  const hole = HOLES[alphabet]?.[ch];
  if (hole) return hole;
  const [upper, lower, digit] = STARTS[alphabet];
  const code = ch.charCodeAt(0);
  if (ch >= 'A' && ch <= 'Z') return String.fromCodePoint(upper + code - 65);
  if (ch >= 'a' && ch <= 'z') return String.fromCodePoint(lower + code - 97);
  if (ch >= '0' && ch <= '9' && digit !== null)
    return String.fromCodePoint(digit + code - 48);
  return ch;
}
