import { Store } from '../core/store.ts';
import type { PluginStatus } from '../references/zotero-plugin.ts';
import type { VaultBackend } from '../storage/vault.ts';

export interface ZoteroPluginState {
  status: PluginStatus;
  /** Keep the connection, not just this session (in the vault). */
  remember: boolean;
  /** Where Remember keeps it, for the option's label; null: it can't. */
  how: VaultBackend['kind'] | null;
}

/** The Zotero plugin connection (ADR 0024). */
export const zoteroPluginStore = new Store<ZoteroPluginState>({
  status: { state: 'idle' },
  remember: false,
  how: null,
});
