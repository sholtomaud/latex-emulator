import type {
  BibFile,
  DocumentRepository,
  StoredDocument,
  VersionRecord,
} from './types.ts';

/** In-memory documents: for tests, and a fallback when IndexedDB is unavailable. */
export class MemoryRepository implements DocumentRepository {
  private docs = new Map<string, StoredDocument>();
  private versions: VersionRecord[] = [];
  private bibFiles = new Map<string, BibFile>();

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

  async listVersions(documentId: string): Promise<VersionRecord[]> {
    return this.versions
      .filter((v) => v.documentId === documentId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((v) => ({ ...v }));
  }

  async addVersion(version: VersionRecord): Promise<void> {
    this.versions.push({ ...version });
  }

  async deleteVersions(documentId: string): Promise<void> {
    this.versions = this.versions.filter((v) => v.documentId !== documentId);
  }

  async listBibFiles(): Promise<BibFile[]> {
    return [...this.bibFiles.values()].map((f) => ({ ...f }));
  }

  async putBibFile(file: BibFile): Promise<void> {
    this.bibFiles.set(file.name, { ...file });
  }

  async deleteBibFile(name: string): Promise<void> {
    this.bibFiles.delete(name);
  }
}
