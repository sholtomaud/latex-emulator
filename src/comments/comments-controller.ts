/**
 * The open document's comment threads (ADR 0025): drafting one on a
 * selection, replies, resolving, and keeping anchors in step with edits.
 * Storage, ids and the clock are passed in, so this is tested in Node;
 * comments-service.ts wires it to the browser.
 */
import { Store } from '../core/store.ts';
import { reanchor, shiftAnchor } from './anchors.ts';
import type { Anchor, Edit, Range } from './anchors.ts';
import {
  addMessage,
  newThread,
  parseThreads,
  setResolved,
  sortThreads,
} from './threads.ts';
import type { Author, Thread } from './threads.ts';

/** Where threads are kept, per document. */
export interface ThreadStore {
  get(documentId: string): Promise<Thread[] | undefined>;
  put(documentId: string, threads: Thread[]): Promise<void>;
  delete(documentId: string): Promise<void>;
}

export class MemoryThreads implements ThreadStore {
  private map = new Map<string, Thread[]>();
  async get(id: string) {
    return this.map.get(id);
  }
  async put(id: string, threads: Thread[]) {
    this.map.set(id, threads);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}

export interface CommentsDeps {
  store: ThreadStore;
  newId: () => string;
  now: () => number;
}

export interface CommentsState {
  documentId: string | null;
  /** The source the anchors refer to. */
  source: string;
  threads: Thread[];
  /** A comment being written on a selection, not yet a thread. */
  draft: Anchor | null;
  /** The thread to show (just made, or picked in the editor). */
  focus: string | null;
}

/** Saving after typing waits this long for a pause. */
const SAVE_DELAY = 500;

export class CommentsController {
  readonly store = new Store<CommentsState>({
    documentId: null,
    source: '',
    threads: [],
    draft: null,
    focus: null,
  });
  private deps: CommentsDeps;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: CommentsDeps) {
    this.deps = deps;
  }

  /** Its text is gone: the anchor collapsed or its quote can't be found. */
  isLost(thread: Thread): boolean {
    return thread.anchor.start >= thread.anchor.end;
  }

  async openDocument(documentId: string, source: string) {
    await this.flush();
    this.store.setState({
      documentId,
      source,
      threads: [],
      draft: null,
      focus: null,
    });
    const stored = parseThreads((await this.deps.store.get(documentId)) ?? []);
    if (this.store.getState().documentId !== documentId) return;
    this.store.setState({ threads: stored });
    this.sourceReplaced(source);
  }

  /** Comment on a selection: a draft until its first message is added. */
  startComment(range: Range) {
    const { source } = this.store.getState();
    if (range.end <= range.start) return;
    this.store.setState({
      draft: { ...range, quote: source.slice(range.start, range.end) },
    });
  }

  cancelDraft() {
    this.store.setState({ draft: null });
  }

  /** The draft becomes a thread, opened by `author`. */
  async addDraft(text: string, author: Author = 'you') {
    const { draft } = this.store.getState();
    if (!draft || !text.trim()) return;
    const thread = newThread({
      id: this.deps.newId(),
      anchor: draft,
      author,
      text,
      at: this.deps.now(),
    });
    await this.commit(sortThreads([...this.store.getState().threads, thread]), {
      draft: null,
      focus: thread.id,
    });
  }

  /** A thread on `anchor` straight away (the assistant's comments). */
  async add(
    anchor: Anchor,
    text: string,
    author: Author
  ): Promise<Thread | null> {
    if (anchor.end <= anchor.start || !text.trim()) return null;
    const thread = newThread({
      id: this.deps.newId(),
      anchor,
      author,
      text,
      at: this.deps.now(),
    });
    await this.commit(sortThreads([...this.store.getState().threads, thread]));
    return thread;
  }

  async reply(id: string, author: Author, text: string) {
    await this.update(id, (t) => addMessage(t, author, text, this.deps.now()));
  }

  async resolve(id: string, resolved: boolean, who: Author) {
    await this.update(id, (t) =>
      setResolved(t, resolved, who, this.deps.now())
    );
  }

  focus(id: string | null) {
    this.store.setState({ focus: id });
  }

  /**
   * Edits made in the editor, in the old text's offsets (as Monaco reports
   * them), and the text after them. Applied from the last, so earlier
   * offsets stay valid.
   */
  applyEdits(edits: Edit[], source: string) {
    const ordered = [...edits].sort((a, b) => b.offset - a.offset);
    const move = (a: Anchor): Anchor => {
      let r: Anchor = a;
      for (const e of ordered) r = shiftAnchor(r, e);
      return {
        ...r,
        quote: r.end > r.start ? source.slice(r.start, r.end) : a.quote,
      };
    };
    const { threads, draft } = this.store.getState();
    this.store.setState({
      source,
      threads: threads.map((t) => ({ ...t, anchor: move(t.anchor) })),
      draft: draft ? move(draft) : null,
    });
    this.saveLater();
  }

  /** The whole text changed outside the editor: find each thread again. */
  sourceReplaced(source: string) {
    const threads = this.store.getState().threads.map((t) => {
      const found = reanchor(source, t.anchor);
      const anchor = found
        ? { ...found, quote: t.anchor.quote }
        : { start: 0, end: 0, quote: t.anchor.quote };
      return { ...t, anchor };
    });
    this.store.setState({ source, threads: sortThreads(threads), draft: null });
    this.saveLater();
  }

  /** Save now (a pending save after typing, or before switching). */
  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const { documentId, threads } = this.store.getState();
    if (documentId) await this.deps.store.put(documentId, threads);
  }

  async forget(documentId: string) {
    await this.deps.store.delete(documentId);
  }

  private saveLater() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async update(id: string, change: (t: Thread) => Thread) {
    const threads = this.store
      .getState()
      .threads.map((t) => (t.id === id ? change(t) : t));
    await this.commit(sortThreads(threads));
  }

  private async commit(threads: Thread[], extra: Partial<CommentsState> = {}) {
    this.store.setState({ threads, ...extra });
    await this.flush();
  }
}
