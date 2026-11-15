import { Store } from '../core/store.ts';
import type { FolderState } from '../workspace/folder-sync.ts';

/** The open document's folder on this computer (ADR 0015 phase B). */
export const folderStore = new Store<FolderState>({
  supported: false,
  documentId: null,
  link: null,
  permission: null,
  conflicts: [],
  status: '',
});
