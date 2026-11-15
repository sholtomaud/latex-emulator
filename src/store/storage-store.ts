import { Store } from '../core/store.ts';
import type { StorageHealth } from '../storage/storage-health.ts';

export interface StorageStoreState {
  /** null until the browser's storage facts are in. */
  health: StorageHealth | null;
  /** The last backup or restore's outcome. */
  status: string;
  /** A backup or restore is running. */
  busy: boolean;
}

/** Where the documents live and how safe they are (ADR 0019). */
export const storageStore = new Store<StorageStoreState>({
  health: null,
  status: '',
  busy: false,
});
