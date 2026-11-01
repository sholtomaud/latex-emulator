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

/** A text edit in Monaco's coordinates. */
export interface EditData {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;
}

/**
 * The quick-fixes of diagnostics that overlap [start, end] (offsets), with
 * their edits in Monaco's coordinates for `text`. A fix offered by several
 * diagnostics (e.g. the same missing file) appears once.
 */
export function fixesAt(
  diagnostics: Diagnostic[],
  text: string,
  start: number,
  end: number
): { title: string; edits: EditData[] }[] {
  const map = createPositionMap(text);
  const seen = new Set<string>();
  const out: { title: string; edits: EditData[] }[] = [];
  for (const d of diagnostics) {
    if (d.range.end < start || d.range.start > end) continue;
    for (const fix of d.fixes ?? []) {
      const id = JSON.stringify(fix);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        title: fix.title,
        edits: fix.edits.map((e) => {
          const a = map.toPosition(e.range.start);
          const b = map.toPosition(e.range.end);
          return {
            range: {
              startLineNumber: a.lineNumber,
              startColumn: a.column,
              endLineNumber: b.lineNumber,
              endColumn: b.column,
            },
            text: e.text,
          };
        }),
      });
    }
  }
  return out;
}
