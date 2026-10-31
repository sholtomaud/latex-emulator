import type { languages } from 'monaco-editor';

export const LATEX_LANGUAGE_ID = 'latex';

const STRUCTURE =
  /\\(?:documentclass|usepackage|title|author|date|maketitle|tableofcontents|part|section|subsection|subsubsection|paragraph|subparagraph|label|ref|eqref|pageref|item)\*?(?![a-zA-Z@])/;

/**
 * Monarch grammar for syntax highlighting only. Meaning (diagnostics,
 * completion, hover) comes from the real parser, never from this grammar.
 */
export const latexMonarch: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.latex',
  tokenizer: {
    root: [
      [/%.*$/, 'comment'],
      [/\\\[/, { token: 'string.math', next: '@bracketMath' }],
      [/\\\(/, { token: 'string.math', next: '@parenMath' }],
      [/\$\$/, { token: 'string.math', next: '@displayMath' }],
      [/\$/, { token: 'string.math', next: '@inlineMath' }],
      [
        /(\\(?:begin|end))(\s*)(\{)([^}]*)(\})/,
        ['keyword', '', 'delimiter.curly', 'type', 'delimiter.curly'],
      ],
      [STRUCTURE, 'keyword'],
      [/\\[%$&#_{}~^\\ ,]/, 'string.escape'],
      [/\\[a-zA-Z@]+\*?/, 'tag'],
      [/\\./, 'tag'],
      [/[{}]/, 'delimiter.curly'],
      [/[[\]]/, 'delimiter.square'],
      [/[&~^_#]/, 'operator'],
      [/[^\\%${}[\]&~^_#]+/, ''],
    ],
    inlineMath: [
      [/\$/, { token: 'string.math', next: '@pop' }],
      { include: '@mathBody' },
    ],
    displayMath: [
      [/\$\$/, { token: 'string.math', next: '@pop' }],
      { include: '@mathBody' },
    ],
    bracketMath: [
      [/\\\]/, { token: 'string.math', next: '@pop' }],
      { include: '@mathBody' },
    ],
    parenMath: [
      [/\\\)/, { token: 'string.math', next: '@pop' }],
      { include: '@mathBody' },
    ],
    mathBody: [
      [/%.*$/, 'comment'],
      [/\\[a-zA-Z@]+/, 'keyword.math'],
      [/\\./, 'string.math'],
      [/[{}]/, 'delimiter.curly'],
      [/[^$\\%{}]+/, 'string.math'],
    ],
  },
};

export const latexLanguageConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: '%' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$' },
    { open: '`', close: "'" },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$' },
  ],
  folding: {
    markers: { start: /^\s*\\begin\{/, end: /^\s*\\end\{/ },
  },
  wordPattern: /\\?[A-Za-z@]+\*?|[^\s\\{}[\]$%&~^_#]+/,
};
