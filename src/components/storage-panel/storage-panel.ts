import { BaseComponent } from '../../core/base-component.ts';
import { storageStore } from '../../store/storage-store.ts';
import type { StorageStoreState } from '../../store/storage-store.ts';
import { storageActions } from '../../workspace/workspace-service.ts';
import template from './storage-panel.html?raw';
import style from './storage-panel.css?raw';

/**
 * Where the documents live (ADR 0019): this browser only, whether the
 * browser has agreed not to clear them, how full storage is and when the
 * last backup was; back up the whole workspace and restore a backup.
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
    this.render(storageStore.getState());
    storageStore.addEventListener('change', ((
      e: CustomEvent<StorageStoreState>
    ) => this.render(e.detail)) as EventListener);
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

if (!customElements.get(StoragePanelComponent.tagName)) {
  customElements.define(StoragePanelComponent.tagName, StoragePanelComponent);
}
