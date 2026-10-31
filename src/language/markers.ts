import type { Diagnostic } from '../latex/diagnostics.ts';
import { createPositionMap } from './positions.ts';

/** monaco.MarkerSeverity values (kept here so this module stays Monaco-free). */
export const MarkerSeverity = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8,
} as const;

export type MarkerSeverityValue =
  (typeof MarkerSeverity)[keyof typeof MarkerSeverity];

/** Shape of monaco.editor.IMarkerData that we produce. */
export interface MarkerData {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  severity: MarkerSeverityValue;
  message: string;
  code: string;
  source: string;
}

const SEVERITY: Record<Diagnostic['severity'], MarkerSeverityValue> = {
  error: MarkerSeverity.Error,
  warning: MarkerSeverity.Warning,
  info: MarkerSeverity.Info,
  hint: MarkerSeverity.Hint,
};

/** Diagnostics (UTF-16 offsets) → Monaco markers for `text`. */
export function toMarkers(
  diagnostics: Diagnostic[],
  text: string
): MarkerData[] {
  const map = createPositionMap(text);
  return diagnostics.map((d) => {
    let { start, end } = d.range;
    // Monaco draws nothing for an empty range: cover one character.
    if (end <= start) {
      if (start < text.length) end = start + 1;
      else if (start > 0) {
        start = text.length - 1;
        end = text.length;
      }
    }
    const s = map.toPosition(start);
    const e = map.toPosition(end);
    return {
      startLineNumber: s.lineNumber,
      startColumn: s.column,
      endLineNumber: e.lineNumber,
      endColumn: e.column,
      severity: SEVERITY[d.severity],
      message: d.message,
      code: d.code,
      source: 'latex',
    };
  });
}
