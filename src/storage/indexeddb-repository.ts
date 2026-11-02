import type {
  BibFile,
  ImageBlob,
  ImageEntry,
  DocumentRepository,
  StoredDocument,
  VersionRecord,
} from './types.ts';

const DB_NAME = 'latex-emulator';
// v2 adds the versions store (ADR 0006); v3 the .bib files (ADR 0007);
// v4 the images and their content-addressed blobs (ADR 0013).
const DB_VERSION = 4;
const STORE = 'documents';
const VERSIONS = 'versions';
const BIB_FILES = 'bibFiles';
const IMAGES = 'images';
const IMAGE_BLOBS = 'imageBlobs';

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** What the app hears about other tabs while the database changes version. */
export interface DatabaseEvents {
  /** Another tab holds an older version open, so the upgrade waits. */
  blocked?: () => void;
  /** Another tab wants a newer version; this connection closes right after. */
  versionChange?: () => void;
}

/** Documents in IndexedDB, on the user's device (AGENTS.md §9, §11). */
export class IndexedDbRepository implements DocumentRepository {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(events: DatabaseEvents = {}): Promise<IndexedDbRepository> {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Without this the open waits silently until the other tab closes.
    req.onblocked = () => events.blocked?.();
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(VERSIONS))
        db.createObjectStore(VERSIONS, { keyPath: 'id' }).createIndex(
          'documentId',
          'documentId'
        );
      if (!db.objectStoreNames.contains(BIB_FILES))
        db.createObjectStore(BIB_FILES, { keyPath: 'name' });
      if (!db.objectStoreNames.contains(IMAGES)) {
        const images = db.createObjectStore(IMAGES, { keyPath: 'id' });
        images.createIndex('documentId', 'documentId');
        images.createIndex('sha256', 'sha256');
      }
      if (!db.objectStoreNames.contains(IMAGE_BLOBS))
        db.createObjectStore(IMAGE_BLOBS, { keyPath: 'sha256' });
    };
    const db = await request(req);
    // Never block a newer version of the app: let go (pending writes still
    // finish), after the app has had a chance to save and tell the user.
    db.onversionchange = () => {
      events.versionChange?.();
      db.close();
    };
    return new IndexedDbRepository(db);
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

  listBibFiles(): Promise<BibFile[]> {
    return request(
      this.store('readonly', BIB_FILES).getAll() as IDBRequest<BibFile[]>
    );
  }

  async putBibFile(file: BibFile): Promise<void> {
    await request(this.store('readwrite', BIB_FILES).put(file));
  }

  async deleteBibFile(name: string): Promise<void> {
    await request(this.store('readwrite', BIB_FILES).delete(name));
  }

  listImages(): Promise<ImageEntry[]> {
    return request(
      this.store('readonly', IMAGES).getAll() as IDBRequest<ImageEntry[]>
    );
  }

  getImageBlob(sha256: string): Promise<ImageBlob | undefined> {
    return request(
      this.store('readonly', IMAGE_BLOBS).get(sha256) as IDBRequest<
        ImageBlob | undefined
      >
    );
  }

  /** Entry and blob in one transaction, so a blob is never orphaned. */
  async putImage(entry: ImageEntry, blob?: ImageBlob): Promise<void> {
    const tx = this.db.transaction([IMAGES, IMAGE_BLOBS], 'readwrite');
    const images = tx.objectStore(IMAGES);
    const old = (await request(images.get(entry.id))) as ImageEntry | undefined;
    if (blob) await request(tx.objectStore(IMAGE_BLOBS).put(blob));
    await request(images.put(entry));
    if (old && old.sha256 !== entry.sha256) await collect(tx, old.sha256);
    await done(tx);
  }

  async deleteImage(id: string): Promise<void> {
    const tx = this.db.transaction([IMAGES, IMAGE_BLOBS], 'readwrite');
    await removeEntry(tx, id);
    await done(tx);
  }

  async deleteImages(documentId: string): Promise<void> {
    const tx = this.db.transaction([IMAGES, IMAGE_BLOBS], 'readwrite');
    const ids = await request(
      tx.objectStore(IMAGES).index('documentId').getAllKeys(documentId)
    );
    for (const id of ids) await removeEntry(tx, String(id));
    await done(tx);
  }
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

async function removeEntry(tx: IDBTransaction, id: string) {
  const images = tx.objectStore(IMAGES);
  const old = (await request(images.get(id))) as ImageEntry | undefined;
  if (!old) return;
  await request(images.delete(id));
  await collect(tx, old.sha256);
}

/** Delete the blob once no entry refers to it. */
async function collect(tx: IDBTransaction, sha256: string) {
  const users = await request(
    tx.objectStore(IMAGES).index('sha256').count(sha256)
  );
  if (users === 0) await request(tx.objectStore(IMAGE_BLOBS).delete(sha256));
}
