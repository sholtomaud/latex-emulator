import { Store } from '../core/store.ts';
import { SAMPLE_DOCUMENT } from './sample-document.ts';

export interface DocumentState {
  /** The LaTeX source currently in the editor. */
  source: string;
}

export const documentStore = new Store<DocumentState>({
  source: SAMPLE_DOCUMENT,
});
