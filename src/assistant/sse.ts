/**
 * Server-sent events, read incrementally: chunks in, the `data:` payload
 * of each complete event out. Comments (`: …`) and other fields (`event:`,
 * `id:`) are skipped; the providers' payloads say what they are. Pure.
 */
export class SseParser {
  private buffer = '';
  private data: string[] = [];

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      this.line(line, out);
    }
    return out;
  }

  /** The stream ended: whatever event was still open. */
  flush(): string[] {
    const out: string[] = [];
    if (this.buffer) this.line(this.buffer, out);
    this.buffer = '';
    this.line('', out);
    return out;
  }

  private line(line: string, out: string[]) {
    if (line === '') {
      if (this.data.length) out.push(this.data.join('\n'));
      this.data = [];
    } else if (line.startsWith('data:'))
      this.data.push(line.slice(5).replace(/^ /, ''));
  }
}
