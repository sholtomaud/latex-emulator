import type { Project } from './project.ts';
import { projectFiles, saveProject } from './folder-save.ts';
import type { SavedHashes } from './folder-save.ts';
import { directoryOf, permission } from './fs-access.ts';
import type { DirectoryHandle } from './fs-access.ts';

/**
 * Each document's folder on this computer (ADR 0015 phase B): pick it once,
 * save into it with a click or, when the user turns it on, after every
 * autosave. The folder handle is remembered (in IndexedDB in the browser),
 * so later saves need at most the browser's permission prompt. Pure over
 * the injected picker, link store and handles.
 */

export interface FolderLink {
  documentId: string;
  handle: DirectoryHandle;
  folderName: string;
  /** The folder it was created in, when we created it. */
  parentName: string | null;
  /** The .tex file's name in the folder, kept across renames. */
  texPath: string;
  saved: SavedHashes;
  savedAt: number | null;
  /** Save after every autosave (off by default). */
  auto: boolean;
}

export interface FolderLinkStore {
  get(documentId: string): Promise<FolderLink | undefined>;
  put(link: FolderLink): Promise<void>;
  delete(documentId: string): Promise<void>;
}

export class MemoryFolderLinks implements FolderLinkStore {
  private links = new Map<string, FolderLink>();
  async get(id: string) {
    const l = this.links.get(id);
    return l && { ...l };
  }
  async put(link: FolderLink) {
    this.links.set(link.documentId, { ...link });
  }
  async delete(id: string) {
    this.links.delete(id);
  }
}

export interface FolderState {
  /** The browser has the File System Access API. */
  supported: boolean;
  documentId: string | null;
  link: Pick<
    FolderLink,
    'folderName' | 'parentName' | 'savedAt' | 'auto'
  > | null;
  /** For the linked folder: 'prompt' after a reload until a click. */
  permission: PermissionState | null;
  /** Files changed in the folder that a save would overwrite. */
  conflicts: string[];
  status: string;
}

export interface FolderSyncOptions {
  supported: boolean;
  /** The folder picker; null when the user cancels. */
  pick: () => Promise<DirectoryHandle | null>;
  now: () => number;
  publish: (state: FolderState) => void;
}

const list = (items: string[]) =>
  items.length === 1
    ? items[0]
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export class FolderSync {
  private links: FolderLinkStore;
  private options: FolderSyncOptions;
  private documentId: string | null = null;
  private current: FolderLink | null = null;
  private state: PermissionState | null = null;
  private conflicts: string[] = [];
  private status = '';
  /** Automatic saving stops at a conflict until a save by hand works. */
  private paused = false;
  /** Bumped by every open() and link(): a slower, older open() gives way. */
  private generation = 0;

  constructor(links: FolderLinkStore, options: FolderSyncOptions) {
    this.links = links;
    this.options = options;
  }

  async open(documentId: string): Promise<void> {
    this.documentId = documentId;
    this.current = null;
    this.state = null;
    this.conflicts = [];
    this.status = '';
    this.paused = false;
    const generation = ++this.generation;
    const link = (await this.links.get(documentId)) ?? null;
    const state = link ? await permission(link.handle, false) : null;
    // Another open() or a link() happened meanwhile: theirs is newer.
    if (generation !== this.generation) return;
    this.current = link;
    this.state = state;
    this.publish();
  }

  /** Save the open document's project (a click: may pick and prompt). */
  async save(
    project: Project,
    options: { overwrite?: boolean } = {}
  ): Promise<void> {
    const documentId = this.documentId;
    if (!this.options.supported || documentId === null) return;
    let link = this.current;
    try {
      if (!link) {
        const parent = await this.options.pick();
        if (!parent) return this.publish();
        const handle = await parent.getDirectoryHandle(project.folder, {
          create: true,
        });
        link = {
          documentId,
          handle,
          folderName: handle.name,
          parentName: parent.name,
          texPath: projectFiles(project)[0].path,
          saved: {},
          savedAt: null,
          auto: false,
        };
        this.current = link;
        await this.links.put(link);
      }
      this.state = await permission(link.handle, true);
      if (this.state !== 'granted') {
        this.status = 'The browser didn’t allow saving to that folder.';
        return this.publish();
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError')
        return this.publish();
      return this.fail(e);
    }
    if (await this.write(link, project, options.overwrite ?? false))
      this.paused = false;
  }

  /** Whether autoSave would do anything (so callers can skip building). */
  wantsAutoSave(): boolean {
    return Boolean(
      this.current?.auto && !this.paused && !this.conflicts.length
    );
  }

  /** After an autosave: only with the user's say-so and standing permission. */
  async autoSave(project: Project): Promise<void> {
    const link = this.current;
    if (!link?.auto || this.paused || this.conflicts.length) return;
    try {
      this.state = await permission(link.handle, false);
    } catch (e) {
      return this.fail(e);
    }
    if (this.state !== 'granted') return this.publish();
    await this.write(link, project, false);
  }

  /** Show a message (e.g. what opening a folder did). */
  say(status: string): void {
    this.status = status;
    this.publish();
  }

  /** Drop a pending conflict, keeping the folder's copies. */
  cancel(): void {
    if (!this.conflicts.length) return;
    this.conflicts = [];
    this.status = 'Not saved: the folder keeps its copy.';
    this.publish();
  }

  async setAuto(on: boolean): Promise<void> {
    if (!this.current) return;
    this.current = { ...this.current, auto: on };
    await this.links.put(this.current);
    this.publish();
  }

  /** Remember a folder the document was opened from. */
  async link(
    documentId: string,
    handle: DirectoryHandle,
    from: { texPath: string; saved: SavedHashes }
  ): Promise<void> {
    const link: FolderLink = {
      documentId,
      handle,
      folderName: handle.name,
      parentName: null,
      texPath: from.texPath,
      saved: from.saved,
      savedAt: this.options.now(),
      auto: false,
    };
    await this.links.put(link);
    if (this.documentId === documentId) {
      this.generation++;
      this.current = link;
      this.state = 'granted';
      this.publish();
    }
  }

  /** Stop saving this document to its folder (the files stay). */
  async unlink(): Promise<void> {
    if (!this.current) return;
    await this.links.delete(this.current.documentId);
    this.current = null;
    this.state = null;
    this.conflicts = [];
    this.status =
      'This document is no longer saved to a folder. The files there are untouched.';
    this.publish();
  }

  private async write(
    link: FolderLink,
    project: Project,
    overwrite: boolean
  ): Promise<boolean> {
    let r;
    try {
      r = await saveProject(
        directoryOf(link.handle),
        projectFiles(project, link.texPath),
        link.saved,
        { overwrite }
      );
    } catch (e) {
      this.fail(e);
      return false;
    }
    if (!r.ok) {
      this.conflicts = r.conflicts;
      this.paused = true;
      const one = r.conflicts.length === 1;
      this.status = `${list(r.conflicts)} changed in the folder since the last save. Overwrite ${one ? 'it' : 'them'}, or cancel and keep the folder’s ${one ? 'copy' : 'copies'}.`;
      this.publish();
      return false;
    }
    const saved: FolderLink = {
      ...link,
      saved: r.saved,
      savedAt: this.options.now(),
    };
    await this.links.put(saved);
    if (this.current?.documentId === link.documentId) this.current = saved;
    this.conflicts = [];
    const where = `${link.folderName}/${link.parentName ? ` in “${link.parentName}”` : ''}`;
    const n = r.written.length;
    this.status = `Saved to ${where}: ${n ? `${n} ${n === 1 ? 'file' : 'files'} written` : 'nothing had changed'}.`;
    this.publish();
    return true;
  }

  private fail(e: unknown): void {
    this.status = `Saving to the folder failed: ${e instanceof Error ? e.message : String(e)}`;
    this.publish();
  }

  private publish(): void {
    const l = this.current;
    this.options.publish({
      supported: this.options.supported,
      documentId: this.documentId,
      link: l
        ? {
            folderName: l.folderName,
            parentName: l.parentName,
            savedAt: l.savedAt,
            auto: l.auto,
          }
        : null,
      permission: this.state,
      conflicts: [...this.conflicts],
      status: this.status,
    });
  }
}
