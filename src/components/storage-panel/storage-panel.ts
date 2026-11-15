import { BaseComponent } from '../../core/base-component.ts';
import { storageStore } from '../../store/storage-store.ts';
import type { StorageStoreState } from '../../store/storage-store.ts';
import {
  folderActions,
  storageActions,
} from '../../workspace/workspace-service.ts';
import { folderStore } from '../../store/folder-store.ts';
import type { FolderState } from '../../workspace/folder-sync.ts';
import { unsupportedMessage } from '../../workspace/folder-sync.ts';
import template from './storage-panel.html?raw';
import style from './storage-panel.css?raw';

/**
 * Where the documents live (ADR 0019): this browser only, whether the
 * browser has agreed not to clear them, how full storage is and when the
 * last backup was; back up the whole workspace and restore a backup.
 * Below that, the open document's folder on this computer (ADR 0015
 * phase B): save to it, open one, save as you type.
 */
export class StoragePanelComponent extends BaseComponent {
  static tagName = 'storage-panel';

  constructor() {
    super(template, style);
  }

  init() {
    const input = this.querySelector<HTMLInputElement>('.restore-input')!;
    this.querySelector('.backup-all')!.addEventListener('click', () =>
      storageActions.backup()
    );
    this.querySelector('.restore')!.addEventListener('click', () =>
      input.click()
    );
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) await storageActions.restore(file);
    });
    const on = (cls: string, fn: () => void) =>
      this.querySelector(cls)!.addEventListener('click', fn);
    on('.folder-save', () => void folderActions.save());
    on('.folder-open', () => void folderActions.open());
    on('.folder-overwrite', () => void folderActions.save(true));
    on('.folder-cancel', () => folderActions.cancel());
    on('.folder-unlink', () => void folderActions.unlink());
    const auto = this.querySelector<HTMLInputElement>('.folder-auto-input')!;
    auto.addEventListener(
      'change',
      () => void folderActions.setAuto(auto.checked)
    );
    this.renderFolder(folderStore.getState());
    folderStore.addEventListener('change', ((e: CustomEvent<FolderState>) =>
      this.renderFolder(e.detail)) as EventListener);

    this.render(storageStore.getState());
    storageStore.addEventListener('change', ((
      e: CustomEvent<StorageStoreState>
    ) => this.render(e.detail)) as EventListener);
  }

  renderFolder(state: FolderState) {
    const q = <T extends HTMLElement>(cls: string) =>
      this.querySelector<T>(cls)!;
    q('.folder-unsupported').hidden = state.supported;
    // Brave exposes navigator.brave (its documented detection).
    q('.folder-unsupported').textContent = unsupportedMessage({
      brave: 'brave' in navigator,
    });
    q('.folder-controls').hidden = !state.supported;
    if (!state.supported) return;
    q('.folder-where').textContent = folderWhere(state);
    q('.folder-save').textContent = state.link
      ? 'Save to folder'
      : 'Save to folder…';
    q('.folder-conflict').hidden = !state.conflicts.length;
    q('.folder-auto').hidden = !state.link;
    q<HTMLInputElement>('.folder-auto-input').checked = Boolean(
      state.link?.auto
    );
    q('.folder-unlink').hidden = !state.link;
    q('.folder-status').textContent = state.status;
  }

  render({ health, status, busy }: StorageStoreState) {
    const set = (cls: string, text: string) =>
      (this.querySelector(cls)!.textContent = text);
    set('.storage-protection', health?.protection ?? '');
    set('.storage-usage', health?.usage ?? '');
    set('.storage-backup', health?.backup ?? '');
    set('.storage-status', status);
    this.querySelector('.storage')!.classList.toggle(
      'warn',
      health?.level === 'warn'
    );
    for (const b of this.querySelectorAll<HTMLButtonElement>('.storage-button'))
      b.disabled = busy;
  }
}

/** Where the open document's folder is, in words. */
export function folderWhere(state: FolderState): string {
  const l = state.link;
  if (!l) return 'Not saved to a folder on this computer.';
  const where = `${l.folderName}/${l.parentName ? ` in “${l.parentName}”` : ''}`;
  const when = l.savedAt
    ? ` Last saved at ${new Date(l.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
    : '';
  const ask =
    state.permission === 'granted' || state.permission === null
      ? ''
      : ' The browser will ask again before saving there.';
  return `Folder: ${where}.${when}${ask}`;
}

if (!customElements.get(StoragePanelComponent.tagName)) {
  customElements.define(StoragePanelComponent.tagName, StoragePanelComponent);
}
