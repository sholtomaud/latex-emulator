import type { FolderLink, FolderLinkStore } from '../workspace/folder-sync.ts';

/**
 * Each document's folder on this computer (ADR 0015 phase B), in a small
 * database of its own: folder handles can be stored in IndexedDB, and
 * keeping them apart leaves the documents database's version, and the
 * tabs that hold it open, alone. Handles are tied to this browser, so a
 * workspace backup (ADR 0019) leaves them out.
 */

const DB_NAME = 'latex-emulator-folders';
const STORE = 'links';

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class IndexedDbFolderLinks implements FolderLinkStore {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<IndexedDbFolderLinks> {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: 'documentId' });
    const db = await request(req);
    db.onversionchange = () => db.close();
    return new IndexedDbFolderLinks(db);
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  get(documentId: string): Promise<FolderLink | undefined> {
    return request(
      this.store('readonly').get(documentId) as IDBRequest<
        FolderLink | undefined
      >
    );
  }

  async put(link: FolderLink): Promise<void> {
    await request(this.store('readwrite').put(link));
  }

  async delete(documentId: string): Promise<void> {
    await request(this.store('readwrite').delete(documentId));
  }
}
