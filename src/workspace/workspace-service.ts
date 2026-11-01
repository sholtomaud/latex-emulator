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
import { downloadText } from '../util/download.ts';
import { requestPrint } from '../store/print-requests.ts';
import type { Bump } from './versions.ts';
import { BibLibrary } from './bib-library.ts';
import { bibStore } from '../store/bib-store.ts';
import { SAMPLE_REFERENCES } from '../store/sample-references.ts';

/**
 * Browser wiring for the Workspace: IndexedDB, autosave, file import/export.
 * Components call these actions; they never touch storage directly.
 */

const AUTOSAVE_MS = 400;
let workspace: Workspace | null = null;
let library: BibLibrary | null = null;

async function openRepository(): Promise<DocumentRepository> {
  try {
    return await IndexedDbRepository.open();
  } catch (error) {
    console.warn('IndexedDB unavailable; documents will not persist.', error);
    return new MemoryRepository();
  }
}

export async function startWorkspace(): Promise<void> {
  uiStore.setState({ explorerOpen: readPref('explorer-open') === 'true' });
  uiStore.addEventListener('change', ((e: CustomEvent) =>
    writePref(
      'explorer-open',
      String(e.detail.explorerOpen)
    )) as EventListener);

  const repo = await openRepository();
  workspace = new Workspace(repo, {
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    prefs: {
      getActiveId: () => readPref('active-document'),
      setActiveId: (id) => writePref('active-document', id),
    },
    publish: (state) => {
      const switched = state.activeId !== workspaceStore.getState().activeId;
      workspaceStore.setState({ ...state, ready: true });
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

  const saveLater = debounce(() => void flush(), AUTOSAVE_MS);
  documentStore.addEventListener('change', ((_e: CustomEvent<DocumentState>) =>
    saveLater()) as EventListener);
  // Don't lose the last keystrokes when the tab is closed or hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('pagehide', () => void flush());
}

/** Save the editor's text to the open document now. */
async function flush(): Promise<void> {
  await workspace?.save(documentStore.getState().source);
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
  delete: (id: string) => act((w) => w.delete(id)),
  importFile: (file: File) =>
    act(async (w) => w.importFile(file.name, await file.text())),
  download: (id?: string) =>
    act((w) => {
      const file = id ? w.exportDocument(id) : w.exportActive();
      if (file) downloadText(file.fileName, file.text, 'application/x-tex');
    }),
  saveVersion: (bump: Bump = 'patch') =>
    act((w) => w.saveVersion(bump).then(() => {})),
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
      const id = versionId ?? (await w.saveVersion('patch')).id;
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
  deleteBib: async (name: string) => {
    await library?.delete(name);
    bibStore.setState({ status: '' });
  },
  downloadBib: (name: string) => {
    const file = library?.exportFile(name);
    if (file) downloadText(file.fileName, file.text, 'application/x-bibtex');
  },
  toggleExplorer: () =>
    uiStore.setState({ explorerOpen: !uiStore.getState().explorerOpen }),
};
