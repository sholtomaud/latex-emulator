/** Monaco-style position: 1-based line and column, columns in UTF-16 units. */
export interface Position {
  lineNumber: number;
  column: number;
}

export interface PositionMap {
  toPosition(offset: number): Position;
  toOffset(position: Position): number;
}

/** Converts between the parser's UTF-16 offsets and Monaco positions. */
export function createPositionMap(text: string): PositionMap {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === '\n') starts.push(i + 1);

  return {
    toPosition(offset) {
      const o = Math.max(0, Math.min(offset, text.length));
      // Binary search for the last line start <= o.
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= o) lo = mid;
        else hi = mid - 1;
      }
      return { lineNumber: lo + 1, column: o - starts[lo] + 1 };
    },
    toOffset({ lineNumber, column }) {
      const line = Math.max(1, Math.min(lineNumber, starts.length));
      return Math.min(text.length, starts[line - 1] + column - 1);
    },
  };
}
