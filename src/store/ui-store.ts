import { Store } from '../core/store.ts';

export interface UiState {
  explorerOpen: boolean;
  /** An app-level problem the user must act on ('' when none). */
  notice: string;
  /** Edits can't be saved any more (a newer version took the database). */
  readOnly: boolean;
}

/** View state of the app chrome. */
export const uiStore = new Store<UiState>({
  explorerOpen: false,
  notice: '',
  readOnly: false,
});
