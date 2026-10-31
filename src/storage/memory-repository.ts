import type { DocumentRepository, StoredDocument } from './types.ts';

/** In-memory documents: for tests, and a fallback when IndexedDB is unavailable. */
export class MemoryRepository implements DocumentRepository {
  private docs = new Map<string, StoredDocument>();

  async list(): Promise<StoredDocument[]> {
    return [...this.docs.values()].map((d) => ({ ...d }));
  }

  async get(id: string): Promise<StoredDocument | undefined> {
    const d = this.docs.get(id);
    return d && { ...d };
  }

  async put(doc: StoredDocument): Promise<void> {
    this.docs.set(doc.id, { ...doc });
  }

  async delete(id: string): Promise<void> {
    this.docs.delete(id);
  }
}
