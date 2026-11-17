/**
 * Comments in the browser (ADR 0025): one controller following the open
 * document, kept in IndexedDB (in memory when that is unavailable).
 */
import { CommentsController, MemoryThreads } from './comments-controller.ts';
import type { ThreadStore } from './comments-controller.ts';
import type { CommentRecord } from '../workspace/backup.ts';
import { workspaceStore } from '../store/workspace-store.ts';
import type { WorkspaceStoreState } from '../store/workspace-store.ts';

type BackupStore = ThreadStore & { all(): Promise<CommentRecord[]> };

let ready: Promise<BackupStore> | null = null;
const db = () =>
  (ready ??= import('../storage/comments-db.ts')
    .then((m) => m.IndexedDbThreads.open() as Promise<BackupStore>)
    .catch(() => {
      const memory = new MemoryThreads();
      const map = new Map<string, CommentRecord>();
      return {
        get: (id: string) => memory.get(id),
        async put(id: string, threads: CommentRecord['threads']) {
          await memory.put(id, threads);
          map.set(id, { documentId: id, threads, updatedAt: Date.now() });
        },
        async delete(id: string) {
          await memory.delete(id);
          map.delete(id);
        },
        all: async () => [...map.values()],
      };
    }));

const store: ThreadStore = {
  get: async (id) => (await db()).get(id),
  put: async (id, t) => (await db()).put(id, t),
  delete: async (id) => (await db()).delete(id),
};

export const comments = new CommentsController({
  store,
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
});

/** For workspace backups and restores (ADR 0019). */
export const commentRecords = {
  all: async () => (await db()).all(),
  async put(record: CommentRecord) {
    await (await db()).put(record.documentId, record.threads);
  },
  /** After a restore: read the open document's threads again. */
  async reload() {
    const { documentId, source } = comments.store.getState();
    if (documentId) await comments.openDocument(documentId, source);
  },
};

/** Follow the open document; forget a deleted document's threads. */
let known = new Set<string>();
function follow({ activeId, activeSource, documents }: WorkspaceStoreState) {
  // activeSource: the document store changes after the workspace store.
  if (activeId && activeId !== comments.store.getState().documentId)
    void comments.openDocument(activeId, activeSource);
  const ids = new Set(documents.map((d) => d.id));
  for (const id of known) if (!ids.has(id)) void comments.forget(id);
  known = ids;
}
follow(workspaceStore.getState());
workspaceStore.addEventListener('change', ((
  e: CustomEvent<WorkspaceStoreState>
) => follow(e.detail)) as EventListener);
