export interface StoredDocument {
  id: string;
  name: string;
  /** The LaTeX source. */
  source: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
}

/** Where documents live. IndexedDB in the browser; in memory for tests. */
export interface DocumentRepository {
  list(): Promise<StoredDocument[]>;
  get(id: string): Promise<StoredDocument | undefined>;
  put(doc: StoredDocument): Promise<void>;
  delete(id: string): Promise<void>;
}
