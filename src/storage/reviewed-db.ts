import type { ReviewedStore } from '../assistant/review/review-controller.ts';

/**
 * The reviewing agent's memory (ADR 0025 §3): each document's reviewed
 * paragraph keys (SHA-256 of their text), in a small database of its own
 * like the chats. Only keys, never text; left out of backups, since
 * losing them only means paragraphs are reviewed again.
 */

const DB_NAME = 'latex-emulator-reviews';
const STORE = 'reviewed';

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

interface ReviewedRecord {
  documentId: string;
  keys: string[];
}

export class IndexedDbReviewed implements ReviewedStore {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<IndexedDbReviewed> {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: 'documentId' });
    const db = await request(req);
    db.onversionchange = () => db.close();
    return new IndexedDbReviewed(db);
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(documentId: string): Promise<string[] | undefined> {
    const r = (await request(this.store('readonly').get(documentId))) as
      ReviewedRecord | undefined;
    return r?.keys;
  }

  async put(documentId: string, keys: string[]): Promise<void> {
    await request(this.store('readwrite').put({ documentId, keys }));
  }

  async delete(documentId: string): Promise<void> {
    await request(this.store('readwrite').delete(documentId));
  }
}
