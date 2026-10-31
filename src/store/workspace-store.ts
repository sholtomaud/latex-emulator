import { Store } from '../core/store.ts';
import type { WorkspaceState } from '../workspace/workspace.ts';

export interface WorkspaceStoreState extends WorkspaceState {
  /** Documents have been loaded from storage. */
  ready: boolean;
}

/** The document list and which one is open (published by the workspace). */
export const workspaceStore = new Store<WorkspaceStoreState>({
  documents: [],
  activeId: null,
  activeSource: '',
  versions: [],
  ready: false,
});
