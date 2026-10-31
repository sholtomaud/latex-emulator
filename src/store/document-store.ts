import { Store } from '../core/store.ts';

export interface DocumentState {
  /** The LaTeX source currently in the editor. */
  source: string;
}

/**
 * The text being edited. Starts empty; the workspace loads the open document
 * from storage (or the sample, on first run).
 */
export const documentStore = new Store<DocumentState>({ source: '' });
