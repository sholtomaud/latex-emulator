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
  searchViaPlugin,
  callPluginTool,
  zoteroPluginInfo,
} from './zotero-plugin.ts';
import type { ZoteroSearch } from './zotero.ts';

const TOKEN = 'zotero-plugin-token';
/** This session's token; the vault holds it only if remembered. */
let sessionToken: string | null = null;
let rememberedInVault = false;
let checked = false;

/**
 * A remembered token, read only if that can't make the browser ask:
 * search() also serves the citation typeahead, which runs while the user
 * types. Encrypted storage reads silently; the password manager may show
 * its picker, so it is used only once the plugin section has read it.
 */
async function savedTokenSilently(): Promise<string | null> {
  const token =
    appVault.how === 'encrypted'
      ? await appVault.get(TOKEN).catch(() => null)
      : (appVault.cached(TOKEN) ?? null);
  if (token) sessionToken = token;
  return token;
}

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
  /**
   * Search this computer's library through the plugin, if a connection has
   * been made (null: none, use another route). A search is the user's own
   * action, like opening the section.
   */
  async search(query: string): Promise<ZoteroSearch | null> {
    const token = sessionToken ?? (await savedTokenSilently());
    if (!token) return null;
    return searchViaPlugin(fetch, token, query);
  } /** One of the plugin's tools, for the assistant (ADR 0025). */,
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: true; result: unknown } | { ok: false; message: string }> {
    const token = sessionToken ?? (await savedTokenSilently());
    if (!token)
      return {
        ok: false,
        message:
          'Zotero isn’t connected. Ask the author to connect it: References → Zotero plugin → Connect.',
      };
    return callPluginTool(fetch, token, name, args);
  },

  async disconnect(): Promise<void> {
    await forget();
    show({ state: 'idle' });
  },
};
