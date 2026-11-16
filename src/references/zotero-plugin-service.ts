/**
 * Browser wiring for the Zotero plugin (ADR 0024): pairing, the status
 * check, and where the token is kept (secret-store.ts: this session only,
 * or remembered encrypted on this device if the user ticks Remember).
 * Nothing reaches 127.0.0.1 until the user opens the plugin section or
 * clicks Connect, so the browser's local-network prompt follows a click.
 */
import { SecretStore } from '../storage/secret-store.ts';
import { secretDb } from '../storage/secret-db.ts';
import { zoteroPluginStore } from '../store/zotero-plugin-store.ts';
import type { PluginStatus } from './zotero-plugin.ts';
import {
  pairWithZotero,
  pairingCode,
  zoteroPluginInfo,
} from './zotero-plugin.ts';

const TOKEN = 'zotero-plugin-token';
const secrets = new SecretStore(secretDb, crypto.subtle);
let checked = false;

const show = (status: PluginStatus) => zoteroPluginStore.setState({ status });

async function refresh(token: string): Promise<void> {
  show({ state: 'checking' });
  const info = await zoteroPluginInfo(fetch, token);
  if (info.ok) {
    show({
      state: 'connected',
      zoteroVersion: info.zoteroVersion,
      pluginVersion: info.pluginVersion,
    });
    return;
  }
  // Removed in Zotero: this token will never work again.
  if (info.failure === 'unpaired') await secrets.forget(TOKEN);
  show({ state: 'failed', failure: info.failure });
}

export const zoteroPluginActions = {
  /** When the section is first opened: is there a connection, and is it alive? */
  async check(): Promise<void> {
    if (checked) return;
    checked = true;
    const remembered = await secrets.remembered(TOKEN);
    zoteroPluginStore.setState({ remember: remembered });
    const token = await secrets.get(TOKEN);
    if (token) await refresh(token);
  },
  setRemember(remember: boolean) {
    zoteroPluginStore.setState({ remember });
  },
  async connect(): Promise<void> {
    const code = pairingCode(crypto.getRandomValues(new Uint32Array(1))[0]);
    show({ state: 'pairing', code });
    const paired = await pairWithZotero(fetch, code);
    if (!paired.ok) {
      show({ state: 'failed', failure: paired.failure });
      return;
    }
    await secrets
      .set(TOKEN, paired.token, zoteroPluginStore.getState().remember)
      .catch(() => {
        // Storage refused (e.g. private mode): the session copy still works.
      });
    await refresh(paired.token);
  },
  async disconnect(): Promise<void> {
    await secrets.forget(TOKEN);
    show({ state: 'idle' });
  },
};
