/**
 * The single registry of supported commands and environments (AGENTS.md §6).
 * The parser reads argument signatures from here; completion, hover, lint and
 * the renderer read the same table.
 *
 * Signatures use xparse letters: `s` = optional star, `o` = optional [arg],
 * `m` = mandatory argument.
 */

export type ArgSpec = 's' | 'o' | 'm';
export type CommandKind =
  'command' | 'declaration' | 'accent' | 'symbol' | 'preamble';

export interface CommandSpec {
  args: ArgSpec[];
  kind: CommandKind;
  /** One-line hover documentation. */
  doc: string;
}

export interface EnvironmentSpec {
  args: ArgSpec[];
  /** Body is math mode. */
  math: boolean;
  /** `&` is meaningful inside. */
  alignment: boolean;
  doc: string;
}

export function parseSignature(signature: string): ArgSpec[] {
  return signature.split(/\s+/).filter(Boolean) as ArgSpec[];
}

const commands = new Map<string, CommandSpec>();
const environments = new Map<string, EnvironmentSpec>();

function cmd(
  names: string | string[],
  signature: string,
  doc: string,
  kind: CommandKind = 'command'
) {
  for (const name of Array.isArray(names) ? names : [names])
    commands.set(name, { args: parseSignature(signature), kind, doc });
}

function env(
  names: string | string[],
  signature: string,
  doc: string,
  { math = false, alignment = false } = {}
) {
  for (const name of Array.isArray(names) ? names : [names])
    environments.set(name, {
      args: parseSignature(signature),
      math,
      alignment: alignment || math,
      doc,
    });
}

// Preamble
cmd(
  'documentclass',
  'o m',
  'Selects the document class and its options.',
  'preamble'
);
cmd('usepackage', 'o m', 'Loads a package.', 'preamble');
cmd('title', 'm', 'Sets the document title used by \\maketitle.', 'preamble');
cmd(
  'author',
  'm',
  'Sets the author(s); separate several with \\and.',
  'preamble'
);
cmd(
  'date',
  'm',
  'Sets the date used by \\maketitle (default \\today).',
  'preamble'
);
cmd('and', '', 'Separates authors in \\author.');
cmd('thanks', 'm', 'Adds a footnote to the title or author.');
cmd('maketitle', '', 'Typesets the title block.');

// Sectioning
cmd(
  'section',
  's o m',
  'Starts a numbered section (\\section* is unnumbered).'
);
cmd('subsection', 's o m', 'Starts a numbered subsection.');
cmd('subsubsection', 's o m', 'Starts a numbered subsubsection.');
cmd('paragraph', 's o m', 'Starts a run-in paragraph heading.');
cmd('subparagraph', 's o m', 'Starts a run-in subparagraph heading.');

// Text styles
cmd('emph', 'm', 'Emphasises text (italic, or upright inside italic).');
cmd('textbf', 'm', 'Bold text.');
cmd('textit', 'm', 'Italic text.');
cmd('textsl', 'm', 'Slanted text.');
cmd('textsc', 'm', 'Small capitals.');
cmd('texttt', 'm', 'Typewriter (monospaced) text.');
cmd('textrm', 'm', 'Roman (serif) text.');
cmd('textsf', 'm', 'Sans-serif text.');
cmd('textup', 'm', 'Upright text.');
cmd('textmd', 'm', 'Medium-weight text.');
cmd('textnormal', 'm', 'Text in the document’s normal font.');
cmd('underline', 'm', 'Underlined text.');

// Declarations (affect the rest of the current group)
cmd(
  [
    'bfseries',
    'mdseries',
    'itshape',
    'slshape',
    'upshape',
    'scshape',
    'ttfamily',
    'rmfamily',
    'sffamily',
    'normalfont',
    'em',
  ],
  '',
  'Font declaration: applies to the rest of the current group.',
  'declaration'
);
cmd(
  [
    'tiny',
    'scriptsize',
    'footnotesize',
    'small',
    'normalsize',
    'large',
    'Large',
    'LARGE',
    'huge',
    'Huge',
  ],
  '',
  'Size declaration: applies to the rest of the current group.',
  'declaration'
);
cmd(
  ['centering', 'raggedright', 'raggedleft'],
  '',
  'Alignment declaration for the current group.',
  'declaration'
);

// Paragraphs and spacing
cmd('par', '', 'Ends the current paragraph.');
cmd('noindent', '', 'Starts the next paragraph without indentation.');
cmd('indent', '', 'Indents the start of a paragraph.');
cmd('newline', '', 'Breaks the line.');
cmd('\\', 's o', 'Breaks the line.');
cmd('newpage', '', 'Ends the page.');
cmd('clearpage', '', 'Ends the page.');
cmd(
  'item',
  'o',
  'Starts a list item; the optional argument replaces the label.'
);

// Notes and references
cmd('footnote', 'o m', 'Adds a footnote.');
cmd('label', 'm', 'Labels the current section or equation for \\ref.');
cmd('ref', 'm', 'Number of a labelled item.');
cmd('eqref', 'm', 'Equation number in parentheses.');
cmd('pageref', 'm', 'Page of a labelled item.');

// Symbols and logos
cmd('today', '', 'Today’s date.', 'symbol');
cmd('LaTeX', '', 'The LaTeX logo.', 'symbol');
cmd('TeX', '', 'The TeX logo.', 'symbol');
cmd(['ldots', 'dots', 'textellipsis'], '', 'Ellipsis …', 'symbol');
cmd('textbackslash', '', 'Backslash \\', 'symbol');
cmd(
  [
    'textendash',
    'textemdash',
    'textbullet',
    'textquoteleft',
    'textquoteright',
    'textquotedblleft',
    'textquotedblright',
    'S',
    'P',
    'dag',
    'ddag',
    'copyright',
    'textregistered',
    'texttrademark',
    'pounds',
    'ss',
    'ae',
    'AE',
    'oe',
    'OE',
    'o',
    'O',
    'aa',
    'AA',
    'l',
    'L',
    'i',
    'j',
  ],
  '',
  'Text symbol.',
  'symbol'
);
cmd(
  ['%', '$', '&', '#', '_', '{', '}'],
  '',
  'Escaped special character.',
  'symbol'
);
cmd(' ', '', 'Interword space (control space).', 'symbol');
cmd(',', '', 'Thin space.', 'symbol');
cmd(['-', '/', '@'], '', 'Spacing/hyphenation control.', 'symbol');

// Accents
cmd(
  [
    "'",
    '`',
    '^',
    '"',
    '~',
    '=',
    '.',
    'u',
    'v',
    'H',
    'c',
    'r',
    'd',
    'b',
    'k',
    't',
  ],
  'm',
  'Accent over or under the next character.',
  'accent'
);

// Environments
env('document', '', 'The document body.');
env('itemize', '', 'Bulleted list.');
env('enumerate', '', 'Numbered list.');
env('description', '', 'Description list: \\item[term] text.');
env('center', '', 'Centred lines.');
env('flushleft', '', 'Left-aligned lines.');
env('flushright', '', 'Right-aligned lines.');
env('quote', '', 'Short indented quotation.');
env('quotation', '', 'Indented quotation with paragraph indentation.');
env('abstract', '', 'The abstract.');
env(
  ['verbatim', 'verbatim*'],
  '',
  'Text exactly as typed, in typewriter font.'
);
env(
  ['equation', 'equation*', 'displaymath', 'math'],
  '',
  'Displayed equation.',
  { math: true }
);
env(
  ['align', 'align*', 'gather', 'gather*', 'multline', 'multline*'],
  '',
  'Displayed equations (amsmath).',
  { math: true }
);
env('tabular', 'o m', 'A table.', { alignment: true });

export function lookupCommand(name: string): CommandSpec | undefined {
  return commands.get(name);
}

export function lookupEnvironment(name: string): EnvironmentSpec | undefined {
  return environments.get(name);
}

export function commandNames(): string[] {
  return [...commands.keys()];
}

export function environmentNames(): string[] {
  return [...environments.keys()];
}
