import { Store } from '../core/store.ts';

export interface UpdateState {
  /** Switches to a release downloaded in the background; null when none. */
  apply: (() => void) | null;
}

/** A new release of the app is ready (ADR 0021). */
export const updateStore = new Store<UpdateState>({ apply: null });
