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

/** A .bib file in the references library, named as \bibliography{name} reads it. */
export interface BibFile {
  /** File name without .bib. */
  name: string;
  source: string;
  updatedAt: number;
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
  listBibFiles(): Promise<BibFile[]>;
  /** Adds or replaces the file with this name. */
  putBibFile(file: BibFile): Promise<void>;
  deleteBibFile(name: string): Promise<void>;
}
