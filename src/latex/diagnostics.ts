import type { Range } from './source.ts';

export type Severity = 'error' | 'warning' | 'info' | 'hint';
export type DiagnosticSource = 'syntax' | 'lint' | 'spell' | 'ref';

/** A text replacement: `range` of the source becomes `text`. */
export interface TextEdit {
  range: Range;
  text: string;
}

/** A quick-fix the editor offers for a diagnostic. */
export interface DiagnosticFix {
  title: string;
  edits: TextEdit[];
}

/** AGENTS.md §8. `code` values are stable identifiers. */
export interface Diagnostic {
  range: Range;
  severity: Severity;
  code: string;
  message: string;
  source: DiagnosticSource;
  fixes?: DiagnosticFix[];
}
