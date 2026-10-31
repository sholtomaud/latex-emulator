import type { DocumentRepository, StoredDocument } from './types.ts';

const DB_NAME = 'latex-emulator';
const DB_VERSION = 1;
const STORE = 'documents';

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Documents in IndexedDB, on the user's device (AGENTS.md §9, §11). */
export class IndexedDbRepository implements DocumentRepository {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<IndexedDbRepository> {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    return new IndexedDbRepository(await request(req));
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  list(): Promise<StoredDocument[]> {
    return request(
      this.store('readonly').getAll() as IDBRequest<StoredDocument[]>
    );
  }

  get(id: string): Promise<StoredDocument | undefined> {
    return request(
      this.store('readonly').get(id) as IDBRequest<StoredDocument | undefined>
    );
  }

  async put(doc: StoredDocument): Promise<void> {
    await request(this.store('readwrite').put(doc));
  }

  async delete(id: string): Promise<void> {
    await request(this.store('readwrite').delete(id));
  }
}
