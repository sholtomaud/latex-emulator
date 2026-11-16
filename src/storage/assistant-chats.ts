import type { ChatStore } from '../assistant/assistant-controller.ts';
import type { ChatMessage } from '../assistant/providers.ts';

/**
 * Each document's conversation with the assistant (ADR 0023), in a small
 * database of its own, like the folder links: the documents database's
 * version (and the tabs holding it open) is left alone. Conversations are
 * kept on this device only; backups and project folders leave them out.
 */

const DB_NAME = 'latex-emulator-assistant';
const STORE = 'chats';

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

interface ChatRecord {
  documentId: string;
  messages: ChatMessage[];
}

export class IndexedDbChats implements ChatStore {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<IndexedDbChats> {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: 'documentId' });
    const db = await request(req);
    db.onversionchange = () => db.close();
    return new IndexedDbChats(db);
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(documentId: string): Promise<ChatMessage[] | undefined> {
    const r = (await request(this.store('readonly').get(documentId))) as
      ChatRecord | undefined;
    return r?.messages;
  }

  async put(documentId: string, messages: ChatMessage[]): Promise<void> {
    await request(this.store('readwrite').put({ documentId, messages }));
  }

  async delete(documentId: string): Promise<void> {
    await request(this.store('readwrite').delete(documentId));
  }
}
