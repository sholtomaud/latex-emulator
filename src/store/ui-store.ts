import { Store } from '../core/store.ts';
import type { SideView } from '../util/side-views.ts';
import { DEFAULT_WIDTH } from '../assistant/pane.ts';

export interface UiState {
  /** The primary side bar is open (ADR 0022). */
  explorerOpen: boolean;
  /** The view it shows. */
  sideView: SideView;
  /** The secondary side bar, on the right: the Assistant (ADR 0022, 0023). */
  assistantOpen: boolean;
  /** Pinned: a column of the layout. Unpinned: over the preview (ADR 0023). */
  assistantPinned: boolean;
  /** Its width in CSS pixels, dragged from its left edge. */
  assistantWidth: number;
  /** An app-level problem the user must act on ('' when none). */
  notice: string;
  /** Edits can't be saved any more (a newer version took the database). */
  readOnly: boolean;
}

/** View state of the app chrome. */
export const uiStore = new Store<UiState>({
  explorerOpen: false,
  sideView: 'explorer',
  assistantOpen: false,
  assistantPinned: true,
  assistantWidth: DEFAULT_WIDTH,
  notice: '',
  readOnly: false,
});
