import type { ThreadStore } from '../comments/comments-controller.ts';
import type { CommentRecord } from '../workspace/backup.ts';
import type { Thread } from '../comments/threads.ts';

/**
 * Each document's comment threads (ADR 0025), in a small database of their
 * own like the assistant's chats: the documents database keeps its
 * version. Workspace backups include them (ADR 0019).
 */

const DB_NAME = 'latex-emulator-comments';
const STORE = 'threads';

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class IndexedDbThreads implements ThreadStore {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<IndexedDbThreads> {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: 'documentId' });
    const db = await request(req);
    db.onversionchange = () => db.close();
    return new IndexedDbThreads(db);
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(documentId: string): Promise<Thread[] | undefined> {
    const r = (await request(this.store('readonly').get(documentId))) as
      CommentRecord | undefined;
    return r?.threads;
  }

  async put(documentId: string, threads: Thread[]): Promise<void> {
    const record: CommentRecord = {
      documentId,
      threads,
      updatedAt: Math.max(0, ...threads.map((t) => t.updatedAt)),
    };
    await request(this.store('readwrite').put(record));
  }

  async delete(documentId: string): Promise<void> {
    await request(this.store('readwrite').delete(documentId));
  }

  /** Every document's threads, for a backup. */
  async all(): Promise<CommentRecord[]> {
    return (await request(this.store('readonly').getAll())) as CommentRecord[];
  }
}
