/**
 * The assistant in the browser (ADR 0023): one controller for the app,
 * following the open document, with remembered keys in the app's vault
 * (the browser's password manager, else encrypted on this device) and
 * chats in IndexedDB (in memory when unavailable).
 */
import { AssistantController, MemoryChats } from './assistant-controller.ts';
import type { ChatStore } from './assistant-controller.ts';
import { KeyStore } from './key-store.ts';
import { PROVIDER_IDS } from './providers.ts';
import { appVault } from '../storage/app-vault.ts';
import { vaultSection } from '../storage/vault.ts';
import { readPref, writePref } from '../util/browser-prefs.ts';
import { workspaceStore } from '../store/workspace-store.ts';
import { uiStore } from '../store/ui-store.ts';
import type { Excerpt } from './context.ts';
import type { WorkspaceStoreState } from '../store/workspace-store.ts';

export const assistantKeys = new KeyStore(vaultSection(appVault, PROVIDER_IDS));

/** Opened lazily; memory when IndexedDB isn't there. */
const chats: ChatStore = (() => {
  let ready: Promise<ChatStore> | null = null;
  const open = () =>
    (ready ??= import('../storage/assistant-chats.ts')
      .then((m) => m.IndexedDbChats.open())
      .catch(() => new MemoryChats()));
  return {
    get: async (id) => (await open()).get(id),
    put: async (id, m) => (await open()).put(id, m),
    delete: async (id) => (await open()).delete(id),
  };
})();

export const assistant = new AssistantController({
  fetch: (url, init) => fetch(url, init),
  chats,
  keys: assistantKeys,
  readPref,
  writePref,
});

/** Follow the open document; forget the conversation of a deleted one. */
let known = new Set<string>();
function follow({ activeId, documents }: WorkspaceStoreState) {
  const { documentId } = assistant.store.getState();
  const active = documents.find((d) => d.id === activeId);
  if (activeId && activeId !== documentId)
    void assistant.openDocument(activeId, active?.name ?? '');
  else if (active && active.name !== assistant.store.getState().documentName)
    assistant.renameDocument(active.name);
  const ids = new Set(documents.map((d) => d.id));
  for (const id of known) if (!ids.has(id)) void chats.delete(id);
  known = ids;
}
follow(workspaceStore.getState());
workspaceStore.addEventListener('change', ((
  e: CustomEvent<WorkspaceStoreState>
) => follow(e.detail)) as EventListener);

/** The editor's "Ask the Assistant about the Selection": open the chat with it. */
export function askAboutSelection(selection: Excerpt) {
  uiStore.setState({ assistantOpen: true });
  assistant.attach(selection, { focus: true });
}
