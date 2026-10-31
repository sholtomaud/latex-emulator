import type { Range } from './source.ts';

export type Severity = 'error' | 'warning' | 'info' | 'hint';
export type DiagnosticSource = 'syntax' | 'lint' | 'spell' | 'ref';

/** AGENTS.md §8. `code` values are stable identifiers. */
export interface Diagnostic {
  range: Range;
  severity: Severity;
  code: string;
  message: string;
  source: DiagnosticSource;
}
