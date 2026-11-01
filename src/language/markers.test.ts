import { describe, test } from 'node:test';
import assert from 'node:assert';
import { MarkerSeverity, fixesAt, toMarkers } from './markers.ts';
import type { Diagnostic } from '../latex/diagnostics.ts';

const diag = (
  start: number,
  end: number,
  severity: Diagnostic['severity'] = 'error'
): Diagnostic => ({
  range: { start, end },
  severity,
  code: 'syntax/x',
  message: 'msg',
  source: 'syntax',
});

describe('toMarkers', () => {
  test('converts ranges, severity, code and message', () => {
    const [m] = toMarkers([diag(3, 5, 'warning')], 'ab\ncdef');
    assert.deepStrictEqual(m, {
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 3,
      severity: MarkerSeverity.Warning,
      message: 'msg',
      code: 'syntax/x',
      source: 'latex',
    });
  });

  test('maps every severity to Monaco’s values', () => {
    const sev = toMarkers(
      [
        diag(0, 1, 'error'),
        diag(0, 1, 'warning'),
        diag(0, 1, 'info'),
        diag(0, 1, 'hint'),
      ],
      'abc'
    ).map((m) => m.severity);
    assert.deepStrictEqual(sev, [8, 4, 2, 1]);
  });

  test('zero-length ranges are widened to one character so they are visible', () => {
    const [m] = toMarkers([diag(1, 1)], 'abc');
    assert.deepStrictEqual([m.startColumn, m.endColumn], [2, 3]);
  });

  test('a zero-length range at the end of the text widens backwards', () => {
    const [m] = toMarkers([diag(3, 3)], 'abc');
    assert.deepStrictEqual([m.startColumn, m.endColumn], [3, 4]);
  });

  test('an empty document still gets a marker position', () => {
    const [m] = toMarkers([diag(0, 0)], '');
    assert.deepStrictEqual(
      [m.startLineNumber, m.startColumn, m.endColumn],
      [1, 1, 1]
    );
  });
});

describe('fixesAt', () => {
  const text = 'line one\n\\citet{k}\n';
  const d = (
    start: number,
    end: number,
    fixes?: {
      title: string;
      edits: { range: { start: number; end: number }; text: string }[];
    }[]
  ) => ({
    range: { start, end },
    severity: 'warning' as const,
    code: 'ref/undefined-citation',
    message: 'm',
    source: 'ref' as const,
    fixes,
  });

  test('fixes of diagnostics overlapping the range, as line/column edits', () => {
    const fix = {
      title: 'Add',
      edits: [{ range: { start: 19, end: 19 }, text: 'X\n' }],
    };
    assert.deepStrictEqual(fixesAt([d(9, 18, [fix]), d(0, 4)], text, 10, 10), [
      {
        title: 'Add',
        edits: [
          {
            range: {
              startLineNumber: 3,
              startColumn: 1,
              endLineNumber: 3,
              endColumn: 1,
            },
            text: 'X\n',
          },
        ],
      },
    ]);
    assert.deepStrictEqual(fixesAt([d(9, 18, [fix])], text, 0, 3), []);
  });

  test('the same fix offered by several diagnostics appears once', () => {
    const fix = {
      title: 'Add',
      edits: [{ range: { start: 0, end: 0 }, text: 'x' }],
    };
    assert.strictEqual(
      fixesAt([d(0, 9, [fix]), d(0, 9, [fix])], text, 0, 9).length,
      1
    );
  });
});
