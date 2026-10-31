export interface StoredDocument {
  id: string;
  name: string;
  /** The LaTeX source. */
  source: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
}

/** An immutable snapshot of a document's source. */
export interface VersionRecord {
  id: string;
  documentId: string;
  /** Semantic version, e.g. "0.1.2". */
  version: string;
  createdAt: number;
  /** SHA-256 of the UTF-8 source, lower-case hex. */
  sha256: string;
  source: string;
}

/** Where documents live. IndexedDB in the browser; in memory for tests. */
export interface DocumentRepository {
  list(): Promise<StoredDocument[]>;
  get(id: string): Promise<StoredDocument | undefined>;
  put(doc: StoredDocument): Promise<void>;
  delete(id: string): Promise<void>;
  /** A document's versions, newest first. */
  listVersions(documentId: string): Promise<VersionRecord[]>;
  addVersion(version: VersionRecord): Promise<void>;
  deleteVersions(documentId: string): Promise<void>;
}
