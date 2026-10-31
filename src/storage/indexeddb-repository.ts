import type {
  DocumentRepository,
  StoredDocument,
  VersionRecord,
} from './types.ts';

const DB_NAME = 'latex-emulator';
// v2 adds the versions store (ADR 0006).
const DB_VERSION = 2;
const STORE = 'documents';
const VERSIONS = 'versions';

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
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(VERSIONS))
        db.createObjectStore(VERSIONS, { keyPath: 'id' }).createIndex(
          'documentId',
          'documentId'
        );
    };
    return new IndexedDbRepository(await request(req));
  }

  private store(mode: IDBTransactionMode, name = STORE) {
    return this.db.transaction(name, mode).objectStore(name);
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

  async listVersions(documentId: string): Promise<VersionRecord[]> {
    const all = await request(
      this.store('readonly', VERSIONS)
        .index('documentId')
        .getAll(documentId) as IDBRequest<VersionRecord[]>
    );
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async addVersion(version: VersionRecord): Promise<void> {
    await request(this.store('readwrite', VERSIONS).add(version));
  }

  async deleteVersions(documentId: string): Promise<void> {
    const store = this.store('readwrite', VERSIONS);
    const keys = await request(
      store.index('documentId').getAllKeys(documentId)
    );
    await Promise.all(keys.map((k) => request(store.delete(k))));
  }
}
