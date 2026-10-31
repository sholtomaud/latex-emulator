import type { DocumentRepository, StoredDocument } from '../storage/types.ts';
import { fileNameFor, nameFromFileName, uniqueName } from './names.ts';

/** The skeleton for File → New. Standard LaTeX only. */
export const NEW_DOCUMENT_SOURCE = String.raw`\documentclass[11pt,a4paper]{article}

\title{Untitled}
\author{}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}


\end{document}
`;

export interface DocumentMeta {
  id: string;
  name: string;
  updatedAt: number;
}

export interface WorkspaceState {
  /** Most recently edited first. */
  documents: DocumentMeta[];
  activeId: string | null;
  /** Source of the active document when it was opened or last saved. */
  activeSource: string;
}

export interface WorkspaceOptions {
  now: () => number;
  newId: () => string;
  /** Remembers which document was open (e.g. localStorage). */
  prefs: {
    getActiveId(): string | null;
    setActiveId(id: string): void;
  };
  /** Called with the new state after every change. */
  publish: (state: WorkspaceState) => void;
}

/**
 * The user's documents: create, open, rename, delete, save, import, export.
 * Pure logic over a DocumentRepository; no DOM.
 */
export class Workspace {
  private docs = new Map<string, StoredDocument>();
  private activeId: string | null = null;
  private repo: DocumentRepository;
  private options: WorkspaceOptions;

  constructor(repo: DocumentRepository, options: WorkspaceOptions) {
    this.repo = repo;
    this.options = options;
  }

  /** Load documents; on first run create `sample`. Opens the remembered one. */
  async init(sample: { name: string; source: string }): Promise<void> {
    for (const d of await this.repo.list()) this.docs.set(d.id, d);
    if (this.docs.size === 0) {
      await this.add(sample.name, sample.source);
      return;
    }
    const remembered = this.options.prefs.getActiveId();
    const id =
      remembered && this.docs.has(remembered)
        ? remembered
        : this.sorted()[0].id;
    this.setActive(id);
  }

  async open(id: string): Promise<void> {
    if (!this.docs.has(id) || id === this.activeId) return;
    this.setActive(id);
  }

  async create(): Promise<void> {
    await this.add('Untitled', NEW_DOCUMENT_SOURCE);
  }

  async importFile(fileName: string, text: string): Promise<void> {
    await this.add(nameFromFileName(fileName), text);
  }

  /** Save `source` to the active document. Unchanged text is not rewritten. */
  async save(source: string): Promise<void> {
    const doc = this.activeId ? this.docs.get(this.activeId) : undefined;
    if (!doc || doc.source === source) return;
    const updated = { ...doc, source, updatedAt: this.options.now() };
    this.docs.set(doc.id, updated);
    await this.repo.put(updated);
    this.publish();
  }

  async rename(id: string, name: string): Promise<void> {
    const doc = this.docs.get(id);
    if (!doc || !name.trim()) return;
    const others = [...this.docs.values()]
      .filter((d) => d.id !== id)
      .map((d) => d.name);
    const updated = { ...doc, name: uniqueName(name, others) };
    this.docs.set(id, updated);
    await this.repo.put(updated);
    this.publish();
  }

  async delete(id: string): Promise<void> {
    if (!this.docs.has(id)) return;
    this.docs.delete(id);
    await this.repo.delete(id);
    if (this.docs.size === 0) {
      await this.create();
      return;
    }
    if (id === this.activeId) this.setActive(this.sorted()[0].id);
    else this.publish();
  }

  /** The active document as a downloadable .tex file. */
  exportActive(): { fileName: string; text: string } | null {
    return this.activeId ? this.exportDocument(this.activeId) : null;
  }

  /** Any document as a downloadable .tex file. */
  exportDocument(id: string): { fileName: string; text: string } | null {
    const doc = this.docs.get(id);
    return doc ? { fileName: fileNameFor(doc.name), text: doc.source } : null;
  }

  // ---------------------------------------------------------------- internals

  private async add(name: string, source: string): Promise<void> {
    const now = this.options.now();
    const doc: StoredDocument = {
      id: this.options.newId(),
      name: uniqueName(
        name,
        [...this.docs.values()].map((d) => d.name)
      ),
      source,
      createdAt: now,
      updatedAt: now,
    };
    this.docs.set(doc.id, doc);
    await this.repo.put(doc);
    this.setActive(doc.id);
  }

  private setActive(id: string) {
    this.activeId = id;
    this.options.prefs.setActiveId(id);
    this.publish();
  }

  private sorted(): StoredDocument[] {
    return [...this.docs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private publish() {
    this.options.publish({
      documents: this.sorted().map(({ id, name, updatedAt }) => ({
        id,
        name,
        updatedAt,
      })),
      activeId: this.activeId,
      activeSource: this.activeId
        ? (this.docs.get(this.activeId)?.source ?? '')
        : '',
    });
  }
}
