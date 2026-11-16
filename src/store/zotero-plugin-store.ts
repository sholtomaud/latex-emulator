import { Store } from '../core/store.ts';
import type { PluginStatus } from '../references/zotero-plugin.ts';

export interface ZoteroPluginState {
  status: PluginStatus;
  /** Keep the connection on this device (encrypted), not just this session. */
  remember: boolean;
}

/** The Zotero plugin connection (ADR 0024). */
export const zoteroPluginStore = new Store<ZoteroPluginState>({
  status: { state: 'idle' },
  remember: false,
});
