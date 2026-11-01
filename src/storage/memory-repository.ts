import type {
  BibFile,
  ImageBlob,
  ImageEntry,
  DocumentRepository,
  StoredDocument,
  VersionRecord,
} from './types.ts';

/** In-memory documents: for tests, and a fallback when IndexedDB is unavailable. */
export class MemoryRepository implements DocumentRepository {
  private docs = new Map<string, StoredDocument>();
  private versions: VersionRecord[] = [];
  private bibFiles = new Map<string, BibFile>();
  private images = new Map<string, ImageEntry>();
  private blobs = new Map<string, ImageBlob>();

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

  async listImages(): Promise<ImageEntry[]> {
    return [...this.images.values()].map((e) => ({ ...e }));
  }

  async getImageBlob(sha256: string): Promise<ImageBlob | undefined> {
    const b = this.blobs.get(sha256);
    return b && { ...b };
  }

  async putImage(entry: ImageEntry, blob?: ImageBlob): Promise<void> {
    const old = this.images.get(entry.id);
    if (blob) this.blobs.set(blob.sha256, { ...blob });
    this.images.set(entry.id, { ...entry });
    if (old) this.collect(old.sha256);
  }

  async deleteImage(id: string): Promise<void> {
    const old = this.images.get(id);
    if (!old) return;
    this.images.delete(id);
    this.collect(old.sha256);
  }

  async deleteImages(documentId: string): Promise<void> {
    for (const e of this.images.values())
      if (e.documentId === documentId) await this.deleteImage(e.id);
  }

  /** Drop the blob once no entry refers to it. */
  private collect(sha256: string) {
    for (const e of this.images.values()) if (e.sha256 === sha256) return;
    this.blobs.delete(sha256);
  }
}
