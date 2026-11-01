import { Store } from '../core/store.ts';
import type { BibLibraryState } from '../workspace/bib-library.ts';
import type { ZoteroHit } from '../references/zotero.ts';

export interface BibStoreState extends BibLibraryState {
  /** The last import's outcome, for the explorer's status line. */
  status: string;
  /** Where Zotero searches go; the API key is kept in memory elsewhere. */
  zotero: {
    source: 'local' | 'web';
    userId: string;
    /** Suggest Zotero items while typing \\cite{…} keys. */
    typeahead: boolean;
  };
  /** The last Zotero search's results. */
  zoteroHits: ZoteroHit[];
}

/** The references library (.bib files), published by the workspace. */
export const bibStore = new Store<BibStoreState>({
  files: [],
  sources: {},
  status: '',
  zotero: { source: 'local', userId: '', typeahead: false },
  zoteroHits: [],
});
