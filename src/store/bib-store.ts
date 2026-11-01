import { Store } from '../core/store.ts';
import type { BibLibraryState } from '../workspace/bib-library.ts';

export interface BibStoreState extends BibLibraryState {
  /** The last import's outcome, for the explorer's status line. */
  status: string;
}

/** The references library (.bib files), published by the workspace. */
export const bibStore = new Store<BibStoreState>({
  files: [],
  sources: {},
  status: '',
});
