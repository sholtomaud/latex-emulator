import { Store } from '../core/store.ts';
import type { ImageLibraryState } from '../workspace/image-library.ts';

export interface ImageStoreState extends ImageLibraryState {
  /** The last action's outcome, for the explorer's status line. */
  status: string;
}

/** The open document's images (ADR 0013), published by the workspace. */
export const imageStore = new Store<ImageStoreState>({
  documentId: null,
  images: [],
  elsewhere: [],
  files: {},
  status: '',
});
