import type { BibFile, DocumentRepository } from '../storage/types.ts';
import { parseBib } from '../latex/bibtex/bib-parser.ts';

export interface BibFileMeta {
  name: string;
  /** Number of entries BibTeX would see. */
  entries: number;
  updatedAt: number;
}

export interface BibLibraryState {
  /** Sorted by name. */
  files: BibFileMeta[];
  /** Sources by name: what \bibliography{name} reads. */
  sources: Record<string, string>;
}

export interface BibLibraryOptions {
  now: () => number;
  publish: (state: BibLibraryState) => void;
}

export interface BibImportResult {
  name: string;
  entries: number;
  /** BibTeX's complaints about the file (undefined macros, bad syntax…). */
  warnings: string[];
}

type BibRepository = Pick<
  DocumentRepository,
  'listBibFiles' | 'putBibFile' | 'deleteBibFile'
>;

/**
 * The name LaTeX would use for a file in \bibliography{…}: the base name
 * without .bib, with spaces and other awkward characters made safe.
 */
export function bibName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').replace(/\.bib$/i, '');
  const name = base
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return name || 'references';
}

/**
 * The references library: .bib files kept as the user's own text (so the
 * project stays standard LaTeX + BibTeX). Pure logic over a repository.
 */
export class BibLibrary {
  private files = new Map<string, BibFile>();
  private repo: BibRepository;
  private options: BibLibraryOptions;

  constructor(repo: BibRepository, options: BibLibraryOptions) {
    this.repo = repo;
    this.options = options;
  }

  /** Load the files; with `seed`, add it when the library is empty. */
  async init(seed?: { name: string; source: string }): Promise<void> {
    for (const f of await this.repo.listBibFiles()) this.files.set(f.name, f);
    if (seed && this.files.size === 0) await this.put(seed.name, seed.source);
    else this.publish();
  }

  /** Add a .bib file, replacing one with the same name. */
  async importFile(fileName: string, text: string): Promise<BibImportResult> {
    const name = bibName(fileName);
    await this.put(name, text);
    const parsed = parseBib(text);
    return { name, entries: parsed.entries.length, warnings: parsed.warnings };
  }

  async delete(name: string): Promise<void> {
    if (!this.files.delete(name)) return;
    await this.repo.deleteBibFile(name);
    this.publish();
  }

  exportFile(name: string): { fileName: string; text: string } | null {
    const f = this.files.get(name);
    return f ? { fileName: `${name}.bib`, text: f.source } : null;
  }

  private async put(name: string, source: string) {
    const file = { name, source, updatedAt: this.options.now() };
    this.files.set(name, file);
    await this.repo.putBibFile(file);
    this.publish();
  }

  private publish() {
    const files = [...this.files.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    this.options.publish({
      files: files.map((f) => ({
        name: f.name,
        entries: parseBib(f.source).entries.length,
        updatedAt: f.updatedAt,
      })),
      sources: Object.fromEntries(files.map((f) => [f.name, f.source])),
    });
  }
}
