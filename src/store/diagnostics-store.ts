import { Store } from '../core/store.ts';
import type { Diagnostic } from '../latex/diagnostics.ts';

export interface DiagnosticsState {
  /** The exact source the diagnostics were computed for. */
  source: string;
  diagnostics: Diagnostic[];
}

/**
 * Latest diagnostics for the document. Published by whoever parses it (the
 * preview today, the language worker later); the editor shows them as markers
 * only if `source` still matches what is in the editor.
 */
export const diagnosticsStore = new Store<DiagnosticsState>({
  source: '',
  diagnostics: [],
});
