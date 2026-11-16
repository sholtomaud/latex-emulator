/**
 * Browser wiring for the Zotero plugin (ADR 0024): pairing, the status
 * check, and where the token is kept. It lasts for the session unless the
 * user ticks Remember; then it goes to the app's vault (vault.ts): the
 * browser's password manager where there is one, else encrypted on this
 * device. Nothing reaches 127.0.0.1 until the user opens the plugin
 * section or clicks Connect, so the browser's local-network prompt
 * follows a click.
 */
import { appVault } from '../storage/app-vault.ts';
import { zoteroPluginStore } from '../store/zotero-plugin-store.ts';
import type { PluginStatus } from './zotero-plugin.ts';
import {
  pairWithZotero,
  pairingCode,
  zoteroPluginInfo,
} from './zotero-plugin.ts';

const TOKEN = 'zotero-plugin-token';
/** This session's token; the vault holds it only if remembered. */
let sessionToken: string | null = null;
let rememberedInVault = false;
let checked = false;

const show = (status: PluginStatus) => zoteroPluginStore.setState({ status });

async function forget(): Promise<void> {
  sessionToken = null;
  if (rememberedInVault) {
    rememberedInVault = false;
    // Only write when there is something to remove: each write to the
    // password manager may make the browser ask.
    await appVault.put(TOKEN, null).catch(() => {});
  }
  zoteroPluginStore.setState({ remember: false });
}

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
  if (info.failure === 'unpaired') await forget();
  show({ state: 'failed', failure: info.failure });
}

export const zoteroPluginActions = {
  /** When the section is first opened: is there a connection, and is it alive? */
  async check(): Promise<void> {
    if (checked) return;
    checked = true;
    zoteroPluginStore.setState({ how: appVault.how });
    const saved = await appVault.get(TOKEN);
    rememberedInVault = saved !== null;
    zoteroPluginStore.setState({ remember: rememberedInVault });
    const token = sessionToken ?? saved;
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
    sessionToken = paired.token;
    if (zoteroPluginStore.getState().remember)
      await appVault.put(TOKEN, paired.token).then(
        () => (rememberedInVault = true),
        // Refused (the user said no, or storage is blocked): the session
        // copy still works.
        () => zoteroPluginStore.setState({ remember: false })
      );
    else if (rememberedInVault) {
      rememberedInVault = false;
      await appVault.put(TOKEN, null).catch(() => {});
    }
    await refresh(paired.token);
  },
  async disconnect(): Promise<void> {
    await forget();
    show({ state: 'idle' });
  },
};
