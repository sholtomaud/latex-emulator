/** Text-level transformations TeX performs through font ligatures. */

export interface TextOptions {
  /** Typewriter fonts have no ligatures: characters print as typed. */
  typewriter?: boolean;
}

const LIGATURES: [RegExp, string][] = [
  [/---/g, '—'],
  [/--/g, '–'],
  [/``/g, '“'],
  [/''/g, '”'],
  [/`/g, '‘'],
  [/'/g, '’'],
];
const SPANISH: [RegExp, string][] = [
  [/\?‘/g, '¿'],
  [/!‘/g, '¡'],
];

export function typesetText(text: string, options: TextOptions = {}): string {
  if (options.typewriter) return text;
  let out = text;
  for (const [re, rep] of LIGATURES) out = out.replace(re, rep);
  for (const [re, rep] of SPANISH) out = out.replace(re, rep);
  return out;
}

/** LaTeX accent command → Unicode combining character. */
const ACCENTS: Record<string, string> = {
  "'": '́',
  '`': '̀',
  '^': '̂',
  '"': '̈',
  '~': '̃',
  '=': '̄',
  '.': '̇',
  u: '̆',
  v: '̌',
  H: '̋',
  c: '̧',
  r: '̊',
  d: '̣',
  b: '̱',
  k: '̨',
  t: '͡',
};

/** Spacing forms used when an accent has nothing to sit on. */
const SPACING: Record<string, string> = {
  "'": '´',
  '`': '`',
  '^': '^',
  '"': '¨',
  '~': '~',
  '=': '¯',
};

export function applyAccent(accent: string, base: string): string {
  const mark = ACCENTS[accent];
  if (!mark) return base;
  if (!base) return SPACING[accent] ?? mark;
  // Dotless i/j exist so accents replace the dot.
  const plain = base.replace(/^ı/, 'i').replace(/^ȷ/, 'j');
  const [first, ...rest] = Array.from(plain);
  return (first + mark).normalize('NFC') + rest.join('');
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** LaTeX's \today: "\monthname\space\number\day, \number\year". */
export function formatToday(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
