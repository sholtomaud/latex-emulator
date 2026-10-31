import { Store } from '../core/store.ts';

export interface UiState {
  explorerOpen: boolean;
}

/** View state of the app chrome. */
export const uiStore = new Store<UiState>({ explorerOpen: false });
