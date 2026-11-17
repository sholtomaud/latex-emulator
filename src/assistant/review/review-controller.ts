/**
 * The reviewing agent's queue (ADR 0025 §3). With "Review as I write" on,
 * a pause in typing reviews each paragraph not yet reviewed, one at a
 * time, in document order; typing pauses the queue again. A paragraph
 * that changes while under review is cancelled and waits for the next
 * pause. A failure pauses the reviewer until the author asks again.
 * "Review whole document" works with the switch off. The model work, the
 * store of reviewed keys and the clock are passed in, so this is tested
 * in Node; review-service.ts wires it to the browser.
 */
import { Store } from '../../core/store.ts';
import { findParagraph, paragraphs, reviewKey } from './paragraphs.ts';
import type { Paragraph } from './paragraphs.ts';

/** Each document's reviewed paragraph keys. */
export interface ReviewedStore {
  get(documentId: string): Promise<string[] | undefined>;
  put(documentId: string, keys: string[]): Promise<void>;
  delete(documentId: string): Promise<void>;
}

export class MemoryReviewed implements ReviewedStore {
  private map = new Map<string, string[]>();
  async get(id: string) {
    return this.map.get(id);
  }
  async put(id: string, keys: string[]) {
    this.map.set(id, keys);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}

export interface ReviewJob {
  documentId: string;
  source: string;
  paragraphs: Paragraph[];
  /** The paragraph to review. */
  index: number;
}

export interface ReviewDeps {
  /** Review one paragraph; resolves with a one-line summary, throws on failure. */
  review(job: ReviewJob, signal: AbortSignal): Promise<string>;
  reviewed: ReviewedStore;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** How long a pause in typing is, in ms. */
  idle?: number;
  /** A paragraph's key (default: reviewKey, its SHA-256). */
  hash?: (text: string) => Promise<string>;
}

export interface ReviewState {
  documentId: string | null;
  /** "Review as I write" is on for this document. */
  on: boolean;
  /** "Review whole document" is running. */
  whole: boolean;
  /** The paragraph under review (its index), or null. */
  reviewing: number | null;
  /** Paragraphs in the document, and those not yet reviewed. */
  total: number;
  pending: number;
  /** Why the reviewer paused ('' when it didn't). */
  error: string;
  /** The last review's summary. */
  last: string;
}

const IDLE = 3000;

const plural = (n: number) => `${n} paragraph${n === 1 ? '' : 's'}`;

/** The pane's status line. */
export function reviewStatus(s: ReviewState): string {
  if (s.error) return `Review paused: ${s.error}`;
  if (s.reviewing !== null)
    return `Reviewing paragraph ${s.reviewing + 1} of ${s.total}…`;
  if (s.whole && s.pending) return `${plural(s.pending)} to review.`;
  if (!s.on) return '';
  if (s.pending) return `${plural(s.pending)} to review when you pause.`;
  const last = s.last.length > 200 ? `${s.last.slice(0, 200)}…` : s.last;
  return last
    ? `All paragraphs reviewed. Last: ${last}`
    : 'All paragraphs reviewed.';
}

export class ReviewController {
  readonly store = new Store<ReviewState>({
    documentId: null,
    on: false,
    whole: false,
    reviewing: null,
    total: 0,
    pending: 0,
    error: '',
    last: '',
  });
  private deps: ReviewDeps;
  private idle: number;
  private source = '';
  private lastEdit = 0;
  private keys = new Set<string>();
  private timer: unknown = null;
  private draining: Promise<void> | null = null;
  /** A drain asked for while one was running: run again after it. */
  private again = false;
  private hash: (text: string) => Promise<string>;
  private inflight: {
    abort: AbortController;
    text: string;
    start: number;
  } | null = null;

  constructor(deps: ReviewDeps) {
    this.deps = deps;
    this.idle = deps.idle ?? IDLE;
    this.hash = deps.hash ?? reviewKey;
  }

  async openDocument(documentId: string, source: string, on: boolean) {
    this.cancel();
    this.clearTimer();
    this.source = source;
    this.lastEdit = this.deps.now();
    this.keys = new Set();
    this.store.setState({
      documentId,
      on,
      whole: false,
      reviewing: null,
      total: 0,
      pending: 0,
      error: '',
      last: '',
    });
    const keys = (await this.deps.reviewed.get(documentId)) ?? [];
    if (this.store.getState().documentId !== documentId) return;
    this.keys = new Set(keys);
    this.schedule();
  }

  /** The document's text changed. */
  changed(source: string) {
    this.source = source;
    this.lastEdit = this.deps.now();
    const f = this.inflight;
    if (f && !findParagraph(source, f.text, f.start)) this.cancel();
    this.schedule();
  }

  setOn(on: boolean) {
    if (on === this.store.getState().on) return;
    this.store.setState({ on });
    if (on) this.schedule();
    else if (!this.store.getState().whole) {
      this.cancel();
      this.clearTimer();
    }
  }

  /** Review every paragraph not yet reviewed, now (and resume after a failure). */
  reviewWhole() {
    if (!this.store.getState().documentId) return;
    this.lastEdit = -Infinity;
    this.store.setState({ whole: true, error: '' });
    this.drain();
  }

  /** Stop: cancel the paragraph under review; "as I write" waits for a pause. */
  stop() {
    this.store.setState({ whole: false });
    this.lastEdit = this.deps.now();
    this.cancel();
    this.schedule();
  }

  private cancel() {
    this.inflight?.abort.abort();
    this.inflight = null;
  }

  private clearTimer() {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.clearTimer();
    const s = this.store.getState();
    if (!s.documentId || !(s.on || s.whole) || s.error) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.drain();
    }, this.idle);
  }

  private drain() {
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.loop().finally(() => {
      this.draining = null;
      if (this.again) {
        this.again = false;
        this.drain();
      }
    });
  }

  private async loop() {
    const documentId = this.store.getState().documentId;
    for (;;) {
      const s = this.store.getState();
      if (s.documentId !== documentId || !(s.on || s.whole) || s.error) return;
      const source = this.source;
      const paras = paragraphs(source);
      const keys = await Promise.all(paras.map((p) => this.hash(p.text)));
      if (this.store.getState().documentId !== documentId) return;
      if (this.source !== source) continue;
      const todo = paras
        .map((_, i) => i)
        .filter((i) => !this.keys.has(keys[i]));
      this.store.setState({ total: paras.length, pending: todo.length });
      if (!todo.length) {
        this.store.setState({ whole: false });
        return;
      }
      if (this.deps.now() - this.lastEdit < this.idle) {
        this.schedule();
        return;
      }
      const index = todo[0];
      const abort = new AbortController();
      this.inflight = {
        abort,
        text: paras[index].text,
        start: paras[index].start,
      };
      this.store.setState({ reviewing: index });
      try {
        const last = await this.deps.review(
          { documentId: documentId!, source, paragraphs: paras, index },
          abort.signal
        );
        if (!abort.signal.aborted) {
          // Keep only the keys of paragraphs still in the document.
          const now = new Set(keys);
          this.keys = new Set([...this.keys].filter((k) => now.has(k)));
          this.keys.add(keys[index]);
          await this.deps.reviewed.put(documentId!, [...this.keys]);
          this.store.setState({ last });
        }
      } catch (e) {
        if (!abort.signal.aborted)
          this.store.setState({
            error: e instanceof Error ? e.message : String(e),
            whole: false,
          });
      } finally {
        if (this.inflight?.abort === abort) this.inflight = null;
        this.store.setState({ reviewing: null });
      }
    }
  }
}
