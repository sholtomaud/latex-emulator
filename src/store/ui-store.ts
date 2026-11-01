import { Store } from '../core/store.ts';

export interface UiState {
  explorerOpen: boolean;
  /** An app-level problem the user must act on ('' when none). */
  notice: string;
}

/** View state of the app chrome. */
export const uiStore = new Store<UiState>({
  explorerOpen: false,
  notice: '',
});
