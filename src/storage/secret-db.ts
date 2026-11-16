/**
 * SecretStore's IndexedDB rows (secret-store.ts): a database of its own,
 * so remembered secrets never enter the documents database, its schema
 * upgrades or a workspace backup. CryptoKeys are structured-cloneable, so
 * the non-exportable key is stored as a key, never as bytes we can read.
 * Covered by e2e (zotero-plugin.spec.ts), like indexeddb-repository.ts.
 */
import type { SealedSecret, SecretKv } from './secret-store.ts';

const DB = 'latex-emulator-secrets';
const STORE = 'secrets';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      // Another tab upgrading must never be blocked by us (AGENTS §11).
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The secrets database is blocked.'));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const secretDb: SecretKv = {
  get: (name) => run<SealedSecret | undefined>('readonly', (s) => s.get(name)),
  put: async (name, value) => {
    await run('readwrite', (s) => s.put(value, name));
  },
  delete: async (name) => {
    await run('readwrite', (s) => s.delete(name));
  },
};
