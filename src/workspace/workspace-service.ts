import { Workspace } from './workspace.ts';
import { IndexedDbRepository } from '../storage/indexeddb-repository.ts';
import { MemoryRepository } from '../storage/memory-repository.ts';
import type { DocumentRepository } from '../storage/types.ts';
import { documentStore } from '../store/document-store.ts';
import type { DocumentState } from '../store/document-store.ts';
import { workspaceStore } from '../store/workspace-store.ts';
import { uiStore } from '../store/ui-store.ts';
import { SAMPLE_DOCUMENT } from '../store/sample-document.ts';
import { debounce } from '../util/debounce.ts';
import { readPref, writePref } from '../util/browser-prefs.ts';
import { activateView, parseSideView } from '../util/side-views.ts';
import type { SideView } from '../util/side-views.ts';
import { downloadText } from '../util/download.ts';
import { requestPrint } from '../store/print-requests.ts';
import type { Bump } from './versions.ts';
import { labelMessage, versionSavedMessage } from './versions.ts';
import { BibLibrary } from './bib-library.ts';
import { bibStore } from '../store/bib-store.ts';
import { SAMPLE_REFERENCES } from '../store/sample-references.ts';
import { entryFromCsl, lookupReference } from '../references/lookup.ts';
import { searchZotero } from '../references/zotero.ts';
import type { ZoteroSource } from '../references/zotero.ts';
import { indexLibrary } from '../references/cite-index.ts';
import type { CiteEntry } from '../references/cite-index.ts';
import { createZoteroTypeahead } from '../references/zotero-typeahead.ts';
import { bibliographyFiles } from '../render/bibliography.ts';
import type { CitationServices } from '../language/cite-services.ts';
import { ImageLibrary } from './image-library.ts';
import { imageStore } from '../store/image-store.ts';
import { downloadBlob } from '../util/download.ts';
import { buildProject } from './project.ts';
import { zip, unzip } from '../util/zip.ts';
import { storageHealth } from '../storage/storage-health.ts';
import { storageStore } from '../store/storage-store.ts';
import {
  backupFileName,
  backupFiles,
  planRestore,
  readBackup,
  restoreSummary,
} from './backup.ts';
import type { WorkspaceSnapshot } from './backup.ts';
import { FolderSync, MemoryFolderLinks } from './folder-sync.ts';
import type { FolderLinkStore } from './folder-sync.ts';
import { IndexedDbFolderLinks } from '../storage/folder-links.ts';
import { folderStore } from '../store/folder-store.ts';
import { directoryOf } from './fs-access.ts';
import type { DirectoryHandle } from './fs-access.ts';
import { readProject } from './folder-save.ts';
import { mergeBib } from '../references/bib-subset.ts';
import type { Project } from './project.ts';

/**
 * Browser wiring for the Workspace: IndexedDB, autosave, file import/export.
 * Components call these actions; they never touch storage directly.
 */

const AUTOSAVE_MS = 400;
let workspace: Workspace | null = null;
let library: BibLibrary | null = null;
let images: ImageLibrary | null = null;
let repository: DocumentRepository | null = null;
let folders: FolderSync | null = null;
let folderLinks: FolderLinkStore | null = null;
/** Persistent storage is asked for once a session, after the first save. */
let persistAsked = false;
/** The Zotero web API key: this session only, never stored (like budget-app's ADR 0020). */
let zoteroKey = '';

const BLOCKED_NOTICE =
  'Close other LaTeX Emulator tabs or windows so the app can finish updating.';

async function openRepository(): Promise<DocumentRepository> {
  try {
    const repo = await IndexedDbRepository.open({
      blocked: () => uiStore.setState({ notice: BLOCKED_NOTICE }),
      versionChange: () => {
        // Starts the save transaction before the connection closes.
        void flush();
        // This connection closes now, so later edits could not be saved:
        // stop taking them rather than lose them (ADR 0019).
        uiStore.setState({
          readOnly: true,
          notice:
            'A newer version of LaTeX Emulator was opened in another tab. This tab is now read-only: reload it to keep working.',
        });
      },
    });
    if (uiStore.getState().notice === BLOCKED_NOTICE)
      uiStore.setState({ notice: '' });
    return repo;
  } catch (error) {
    console.warn('IndexedDB unavailable; documents will not persist.', error);
    return new MemoryRepository();
  }
}

export async function startWorkspace(): Promise<void> {
  uiStore.setState({
    explorerOpen: readPref('explorer-open') === 'true',
    sideView: parseSideView(readPref('side-view')),
  });
  uiStore.addEventListener('change', ((e: CustomEvent) => {
    writePref('explorer-open', String(e.detail.explorerOpen));
    writePref('side-view', e.detail.sideView);
  }) as EventListener);

  const repo = await openRepository();
  repository = repo;
  workspace = new Workspace(repo, {
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    prefs: {
      getActiveId: () => readPref('active-document'),
      setActiveId: (id) => writePref('active-document', id),
    },
    publish: (state) => {
      const switched = state.activeId !== workspaceStore.getState().activeId;
      workspaceStore.setState({
        ...state,
        ready: true,
        // A message about another document's versions would mislead.
        ...(switched ? { versionStatus: '' } : {}),
      });
      if (switched) documentStore.setState({ source: state.activeSource });
    },
  });
  await workspace.init({ name: 'A Short Example', source: SAMPLE_DOCUMENT });

  library = new BibLibrary(repo, {
    now: () => Date.now(),
    publish: (state) => bibStore.setState({ ...state }),
  });
  // The starter references.bib is added once; deleting it is respected.
  const seeded = readPref('bib-seeded') === 'true';
  await library.init(
    seeded ? undefined : { name: 'references', source: SAMPLE_REFERENCES }
  );
  writePref('bib-seeded', 'true');
  bibStore.setState({
    zotero: {
      source: readPref('zotero-source') === 'web' ? 'web' : 'local',
      userId: readPref('zotero-user') ?? '',
      typeahead: readPref('zotero-typeahead') === 'true',
    },
  });

  images = new ImageLibrary(repo, {
    now: () => Date.now(),
    publish: (state) => imageStore.setState({ ...state }),
  });
  await images.init();
  const openImages = () => {
    const id = workspaceStore.getState().activeId;
    if (id && id !== imageStore.getState().documentId) void images?.open(id);
  };
  openImages();
  workspaceStore.addEventListener('change', openImages);

  await startFolders();

  const saveLater = debounce(() => void flush(), AUTOSAVE_MS);
  documentStore.addEventListener('change', ((_e: CustomEvent<DocumentState>) =>
    saveLater()) as EventListener);
  // Don't lose the last keystrokes when the tab is closed or hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('pagehide', () => void flush());

  void refreshStorage();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshStorage();
  });
}

const SAVE_FAILED =
  'Your latest changes could not be saved in this browser. Copy your text somewhere safe, then reload the page.';

/** Save the editor's text to the open document now. */
async function flush(): Promise<void> {
  if (!workspace) return;
  try {
    await workspace.save(documentStore.getState().source);
  } catch (error) {
    console.error('Saving failed.', error);
    if (!uiStore.getState().readOnly) uiStore.setState({ notice: SAVE_FAILED });
    return;
  }
  if (uiStore.getState().notice === SAVE_FAILED)
    uiStore.setState({ notice: '' });
  refreshStorageLater();
  if (folders?.wantsAutoSave()) saveToFolderLater();
  if (!persistAsked) {
    persistAsked = true;
    void requestPersistence();
  }
}

/**
 * Ask the browser not to clear our storage under pressure. Chrome decides
 * by itself (installed or often-used sites); Firefox asks the user, which
 * is why this waits for the first save rather than the first visit.
 */
async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted()))
      await navigator.storage.persist();
  } catch {
    // Not available here: the status line says so.
  }
  await refreshStorage();
}

async function persisted(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted
      ? await navigator.storage.persisted()
      : null;
  } catch {
    return null;
  }
}

/** Gather the browser's storage facts and publish the status line. */
async function refreshStorage(): Promise<void> {
  let docs: { updatedAt: number; createdAt: number }[] = [];
  try {
    docs = (await repository?.list()) ?? [];
  } catch {
    // The connection closed (a newer version took over): no dates.
  }
  let estimate: StorageEstimate = {};
  try {
    estimate = (await navigator.storage?.estimate?.()) ?? {};
  } catch {
    // No estimate: the usage line is left out.
  }
  const lastBackup = Number(readPref('last-backup'));
  storageStore.setState({
    health: storageHealth({
      persisted: await persisted(),
      usage: estimate.usage ?? null,
      quota: estimate.quota ?? null,
      lastBackupAt: lastBackup > 0 ? lastBackup : null,
      lastEditAt: docs.length
        ? Math.max(...docs.map((d) => d.updatedAt))
        : null,
      firstCreatedAt: docs.length
        ? Math.min(...docs.map((d) => d.createdAt))
        : null,
      now: Date.now(),
    }),
  });
}
const refreshStorageLater = debounce(() => void refreshStorage(), 1500);

/** Everything in the repository, for a backup. */
async function snapshot(repo: DocumentRepository): Promise<WorkspaceSnapshot> {
  const documents = await repo.list();
  const versions = (
    await Promise.all(documents.map((d) => repo.listVersions(d.id)))
  ).flat();
  const entries = await repo.listImages();
  const blobs: WorkspaceSnapshot['blobs'] = [];
  for (const sha256 of new Set(entries.map((e) => e.sha256))) {
    const blob = await repo.getImageBlob(sha256);
    if (blob)
      blobs.push({
        sha256,
        bytes: new Uint8Array(await blob.blob.arrayBuffer()),
      });
  }
  return {
    documents,
    versions,
    bibFiles: await repo.listBibFiles(),
    images: entries.filter((e) => blobs.some((b) => b.sha256 === e.sha256)),
    blobs,
  };
}

/** Run a backup or restore with the buttons disabled and errors reported. */
async function storageTask(fn: (repo: DocumentRepository) => Promise<string>) {
  const repo = repository;
  if (!repo || storageStore.getState().busy) return;
  if (uiStore.getState().readOnly) {
    storageStore.setState({ status: 'Reload this tab first.' });
    return;
  }
  storageStore.setState({ busy: true, status: '' });
  let status: string;
  try {
    await flush();
    status = await fn(repo);
  } catch (error) {
    console.error(error);
    status = error instanceof Error ? error.message : String(error);
  }
  storageStore.setState({ busy: false, status });
  await refreshStorage();
}

/**
 * The open document as a pdflatex project folder (ADR 0015). A
 * \bibliography file missing from the library is left out; the editor
 * already flags it (ref/missing-bib-file).
 */
async function openProject(): Promise<Project | null> {
  const { activeId: id, documents } = workspaceStore.getState();
  const doc = documents.find((d) => d.id === id);
  if (!id || !doc || !images) return null;
  return buildProject({
    name: doc.name,
    source: documentStore.getState().source,
    bibFiles: bibStore.getState().sources,
    images: await images.filesOf(id),
  });
}

type PickerWindow = {
  showDirectoryPicker?: (options: {
    id?: string;
    mode: 'readwrite';
  }) => Promise<DirectoryHandle>;
};

/** The browser's folder picker; null when cancelled. */
async function pickFolder(): Promise<DirectoryHandle | null> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ id: 'latex-projects', mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** Folders on this computer (ADR 0015 phase B), where the browser has the API. */
async function startFolders(): Promise<void> {
  try {
    folderLinks = await IndexedDbFolderLinks.open();
  } catch {
    folderLinks = new MemoryFolderLinks();
  }
  folders = new FolderSync(folderLinks, {
    supported:
      typeof (window as unknown as PickerWindow).showDirectoryPicker ===
      'function',
    pick: pickFolder,
    now: () => Date.now(),
    publish: (state) => folderStore.setState({ ...state }),
  });
  const follow = () => {
    const id = workspaceStore.getState().activeId;
    if (id && id !== folderStore.getState().documentId) void folders?.open(id);
  };
  follow();
  workspaceStore.addEventListener('change', follow);
}

const saveToFolderLater = debounce(async () => {
  if (!folders?.wantsAutoSave()) return;
  const project = await openProject();
  if (project) await folders.autoSave(project);
}, 1500);

export const folderActions = {
  /** Save the open document's project to its folder (picking one the first time). */
  save: (overwrite = false) =>
    act(async () => {
      const project = await openProject();
      if (project) await folders?.save(project, { overwrite });
    }),
  cancel: () => folders?.cancel(),
  setAuto: (on: boolean) => folders?.setAuto(on),
  unlink: () => folders?.unlink(),
  /** Open a project folder as a new document, and save back into it. */
  open: () =>
    act(async (w) => {
      if (!folders || !images || !library) return;
      const handle = await pickFolder().catch(() => null);
      if (!handle) return;
      const read = await readProject(directoryOf(handle));
      if (!read.ok) return folders.say(read.message);
      const p = read.project;
      await w.importFile(p.texPath, p.source);
      const id = workspaceStore.getState().activeId!;
      await images.open(id);
      for (const image of p.images)
        await images.add(image.name, image.bytes as Uint8Array<ArrayBuffer>, {
          keepPath: true,
        });
      // The library is the one store of entries (ADR 0020): the folder's
      // .bib (a subset written for this document) adds what the library
      // lacks; a key in both keeps the library's copy, and is reported.
      const notes = [`Opened ${p.texPath} from ${handle.name}/.`];
      const saved = { ...p.saved };
      for (const bib of p.bibFiles) {
        const file = `${bib.name}.bib`;
        const mine = bibStore.getState().sources[bib.name];
        if (mine === undefined) {
          await library.importFile(file, bib.source);
          continue;
        }
        const merge = mergeBib(mine, bib.source);
        if (merge.added.length) {
          await library.importFile(file, merge.text);
          const n = merge.added.length;
          notes.push(
            `Added ${n} ${n === 1 ? 'entry' : 'entries'} to ${file} from the folder.`
          );
        }
        if (merge.differing.length) {
          const one = merge.differing.length === 1;
          notes.push(
            `${merge.differing.join(', ')} ${one ? 'differs' : 'differ'} in the folder’s ${file}; your library’s copy was kept.`
          );
          // Not a baseline: saving asks before replacing the folder's copy.
          delete saved[file];
        }
      }
      await folders.link(id, handle, { texPath: p.texPath, saved });
      if (p.missing.length)
        notes.push(`Not in the folder: ${p.missing.join(', ')}.`);
      folders.say(notes.join(' '));
    }),
};

export const storageActions = {
  /** The whole workspace as one zip (ADR 0019). */
  backup: () =>
    storageTask(async (repo) => {
      const now = new Date();
      const files = backupFiles(await snapshot(repo), now.getTime());
      downloadBlob(
        backupFileName(now),
        new Blob([await zip(files, now)], { type: 'application/zip' })
      );
      writePref('last-backup', String(now.getTime()));
      void requestPersistence();
      return `Backed up to ${backupFileName(now)}. Keep it somewhere other than this browser.`;
    }),
  /** Merge a backup into this browser: the newer copy of each item wins. */
  restore: (file: File) =>
    storageTask(async (repo) => {
      const read = await readBackup(
        await unzip(new Uint8Array(await file.arrayBuffer()))
      );
      if (!read.ok) return read.message;
      const now = await snapshot(repo);
      const plan = planRestore(
        {
          documents: now.documents,
          versionIds: new Set(now.versions.map((v) => v.id)),
          bibFiles: now.bibFiles,
          images: now.images,
          blobShas: new Set(now.blobs.map((b) => b.sha256)),
          untouched: {
            documents: new Set(
              now.documents
                .filter((d) => d.source === SAMPLE_DOCUMENT)
                .map((d) => d.id)
            ),
            bibFiles: new Set(
              now.bibFiles
                .filter((b) => b.source === SAMPLE_REFERENCES)
                .map((b) => b.name)
            ),
          },
        },
        read.backup
      );
      for (const id of plan.remove) {
        await repo.delete(id);
        await repo.deleteVersions(id);
        await repo.deleteImages(id);
      }
      for (const d of plan.documents) await repo.put(d);
      for (const v of plan.versions) await repo.addVersion(v);
      for (const b of plan.bibFiles) await repo.putBibFile(b);
      for (const i of plan.images) await repo.putImage(i.entry, i.blob);
      await reload();
      return restoreSummary(plan);
    }),
};

/** Re-read everything from storage (after a restore). */
async function reload(): Promise<void> {
  if (!workspace) return;
  await workspace.init({ name: 'A Short Example', source: SAMPLE_DOCUMENT });
  documentStore.setState({ source: workspaceStore.getState().activeSource });
  await library?.init();
  await images?.init();
  const id = workspaceStore.getState().activeId;
  if (id) await images?.open(id);
}

/** Every action saves pending edits first, so switching never loses text. */
async function act(fn: (w: Workspace) => Promise<void> | void): Promise<void> {
  if (!workspace) return;
  await flush();
  await fn(workspace);
}

export const workspaceActions = {
  open: (id: string) => act((w) => w.open(id)),
  create: () => act((w) => w.create()),
  rename: (id: string, name: string) => act((w) => w.rename(id, name)),
  delete: (id: string) =>
    act(async (w) => {
      await w.delete(id);
      await images?.deleteDocument(id);
      await folderLinks?.delete(id).catch(() => {});
    }),
  importFile: (file: File) =>
    act(async (w) => w.importFile(file.name, await file.text())),
  download: (id?: string) =>
    act((w) => {
      const file = id ? w.exportDocument(id) : w.exportActive();
      if (file) downloadText(file.fileName, file.text, 'application/x-tex');
    }),
  /**
   * The open document as a pdflatex project folder in a .zip (ADR 0015).
   * A \bibliography file missing from the library is left out; the editor
   * already flags it (ref/missing-bib-file).
   */
  downloadProject: () =>
    act(async () => {
      const project = await openProject();
      if (!project) return;
      const bytes = await zip(project.files, new Date());
      downloadBlob(
        project.fileName,
        new Blob([bytes], { type: 'application/zip' })
      );
    }),
  saveVersion: (bump: Bump = 'patch') =>
    act(async (w) => {
      const saved = await w.saveVersion(bump);
      workspaceStore.setState({
        versionStatus: versionSavedMessage(saved, bump),
      });
    }),
  /** Label a version ("submitted"…); an empty label removes it. */
  setVersionLabel: (versionId: string, label: string) =>
    act(async (w) => {
      await w.setVersionLabel(versionId, label);
      const v = workspaceStore
        .getState()
        .versions.find((x) => x.id === versionId);
      if (v)
        workspaceStore.setState({
          versionStatus: labelMessage(v.version, v.label ?? null),
        });
    }),
  downloadVersion: (versionId: string) =>
    act((w) => {
      const file = w.exportVersion(versionId);
      if (file) downloadText(file.fileName, file.text, 'application/x-tex');
    }),
  /**
   * Print a preprint of a version; without one, of the current text (saved
   * as a new patch version first if it changed since the last version).
   */
  preprint: (versionId?: string) =>
    act(async (w) => {
      // The first version of a document a preprint is made from is a minor
      // release (0.1.0), not a patch; later ones are patches.
      const bump = workspaceStore.getState().versions.length
        ? 'patch'
        : 'minor';
      const id = versionId ?? (await w.saveVersion(bump)).id;
      const p = w.preprintOf(id);
      if (p) requestPrint({ source: p.source, title: p.title, stamp: p.stamp });
    }),
  importBib: async (file: File) => {
    if (!library) return;
    const r = await library.importFile(file.name, await file.text());
    const entries = `${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}`;
    const problems = r.warnings.length
      ? `; ${r.warnings.length} problem${r.warnings.length === 1 ? '' : 's'}: ${r.warnings.join(' ')}`
      : '';
    bibStore.setState({
      status: `Imported ${r.name}.bib: ${entries}${problems}. Use \\bibliography{${r.name}}.`,
    });
  },
  /** Look up a DOI/arXiv ID/URL and append the entry to `fileName`.bib. */
  addReference: async (input: string, fileName: string): Promise<boolean> => {
    if (!library) return false;
    bibStore.setState({ status: `Looking up ${input.trim()}…` });
    const r = await lookupReference(input, {
      fetch: (...args) => fetch(...args),
      today: new Date(),
      taken: library.keys(),
    });
    if (!r.ok) {
      bibStore.setState({ status: r.message });
      return false;
    }
    await library.addEntry(fileName, r.text);
    bibStore.setState({
      status:
        r.from === 'doi'
          ? `Added ${r.key} to ${fileName}.bib. Cite it with \\citep{${r.key}}.`
          : `Added ${r.key} to ${fileName}.bib. Add its author and title: a web address alone has no citation record.`,
    });
    return true;
  },
  cleanBib: async (name: string) => {
    if (!library) return;
    const changes = await library.cleanFile(name);
    bibStore.setState({
      status: changes.length
        ? `Cleaned ${name}.bib (${changes.length} ${changes.length === 1 ? 'fix' : 'fixes'}): ${changes.join('; ')}.`
        : `${name}.bib is tidy: layout only, no fixes needed.`,
    });
  },
  setZotero: (source: 'local' | 'web', userId: string, apiKey?: string) => {
    if (apiKey !== undefined) zoteroKey = apiKey;
    zoteroTypeahead.reset();
    writePref('zotero-source', source);
    writePref('zotero-user', userId.trim());
    bibStore.setState({
      zotero: { ...bibStore.getState().zotero, source, userId: userId.trim() },
    });
  },
  setZoteroTypeahead: (on: boolean) => {
    writePref('zotero-typeahead', String(on));
    zoteroTypeahead.reset();
    bibStore.setState({
      zotero: { ...bibStore.getState().zotero, typeahead: on },
    });
  },
  searchZotero: async (query: string) => {
    const { source, userId } = bibStore.getState().zotero;
    bibStore.setState({ status: 'Searching Zotero…', zoteroHits: [] });
    const r = await searchZotero(
      source === 'web'
        ? { kind: 'web', userId, apiKey: zoteroKey }
        : { kind: 'local' },
      query,
      { fetch: (...args) => fetch(...args) }
    );
    bibStore.setState(
      r.ok
        ? {
            zoteroHits: r.hits,
            status: r.hits.length
              ? `${r.hits.length} ${r.hits.length === 1 ? 'item' : 'items'} in Zotero.`
              : 'Nothing in Zotero matches.',
          }
        : { status: r.message }
    );
  },
  /** Add the Zotero search result at `index` to `fileName`.bib. */
  addZoteroHit: async (index: number, fileName: string) => {
    const hit = bibStore.getState().zoteroHits[index];
    if (!library || !hit) return;
    try {
      const { key, text } = entryFromCsl(hit.csl, library.keys());
      await library.addEntry(fileName, text);
      bibStore.setState({
        status: `Added ${key} to ${fileName}.bib. Cite it with \\citep{${key}}.`,
      });
    } catch {
      bibStore.setState({ status: 'That Zotero item could not be converted.' });
    }
  },
  deleteBib: async (name: string) => {
    await library?.delete(name);
    bibStore.setState({ status: '' });
  },
  downloadBib: (name: string) => {
    const file = library?.exportFile(name);
    if (file) downloadText(file.fileName, file.text, 'application/x-bibtex');
  },
  /** Add image files (or a pasted image, named null) to the open document. */
  addImages: async (files: { name: string | null; blob: Blob }[]) => {
    if (!images) return;
    const added: string[] = [];
    const problems: string[] = [];
    for (const f of files) {
      const r = await images.add(
        f.name,
        new Uint8Array(await f.blob.arrayBuffer())
      );
      if (r.ok) added.push(r.name);
      else problems.push(r.message);
    }
    const use = added.length
      ? `Added ${added.join(', ')}. Use \\includegraphics{${added[0]}}.`
      : '';
    imageStore.setState({
      status: [use, ...problems].filter(Boolean).join(' '),
    });
  },
  reuseImage: async (entryId: string) => {
    const r = await images?.reuse(entryId);
    if (r)
      imageStore.setState({
        status: r.ok
          ? `Added ${r.name}. Use \\includegraphics{${r.name}}.`
          : r.message,
      });
  },
  renameImage: async (name: string, newName: string): Promise<boolean> => {
    const r = await images?.rename(name, newName);
    if (!r) return false;
    imageStore.setState({
      status: r.ok ? `Renamed to ${r.name}.` : r.message,
    });
    return r.ok;
  },
  deleteImage: async (name: string) => {
    await images?.delete(name);
    imageStore.setState({ status: '' });
  },
  downloadImage: (name: string) => {
    const file = images?.file(name);
    if (file) downloadBlob(file.fileName, file.blob);
  },
  toggleExplorer: () =>
    uiStore.setState({ explorerOpen: !uiStore.getState().explorerOpen }),
  /** An activity bar icon: open its view, or close the side bar (ADR 0022). */
  showView: (view: SideView) =>
    uiStore.setState(activateView(uiStore.getState(), view)),
};

function zoteroSource(): ZoteroSource {
  const { source, userId } = bibStore.getState().zotero;
  return source === 'web'
    ? { kind: 'web', userId, apiKey: zoteroKey }
    : { kind: 'local' };
}

let indexed: { sources: Record<string, string>; entries: CiteEntry[] } | null =
  null;
/** Zotero suggestions while typing, paused after a failed search. */
const zoteroTypeahead = createZoteroTypeahead({
  search: (source, q) =>
    searchZotero(source, q, { fetch: (...args) => fetch(...args) }),
  keys: () => library?.keys() ?? new Set(),
  onFailure: (status) => bibStore.setState({ status }),
});

/** Citation typeahead and hovers for the editor (src/language/cite-services.ts). */
export const citationServices: CitationServices = {
  entries() {
    const { sources } = bibStore.getState();
    if (indexed?.sources !== sources)
      indexed = { sources, entries: indexLibrary(sources) };
    return indexed.entries;
  },
  zotero(typed) {
    if (!bibStore.getState().zotero.typeahead || !library)
      return Promise.resolve([]);
    return zoteroTypeahead.suggest(zoteroSource(), typed);
  },
  async add(suggestion) {
    if (!library) return;
    // Into the first library file the document's \bibliography lists.
    const { sources } = bibStore.getState();
    const target =
      bibliographyFiles(documentStore.getState().source).find(
        (f) => f in sources
      ) ?? 'references';
    if (library.keys().has(suggestion.key)) return;
    await library.addEntry(target, suggestion.text);
    zoteroTypeahead.reset();
    bibStore.setState({
      status: `Added ${suggestion.key} from Zotero to ${target}.bib.`,
    });
  },
};
