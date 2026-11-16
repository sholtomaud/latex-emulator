import { BaseComponent } from '../../core/base-component.ts';
import { uiStore } from '../../store/ui-store.ts';
import type { UiState } from '../../store/ui-store.ts';
import { storageStore } from '../../store/storage-store.ts';
import type { StorageStoreState } from '../../store/storage-store.ts';
import { workspaceActions } from '../../workspace/workspace-service.ts';
import { parseSideView } from '../../util/side-views.ts';
import template from './activity-bar.html?raw';
import style from './activity-bar.css?raw';

/**
 * The activity bar (ADR 0022): a vertical tablist choosing the primary side
 * bar's view. Clicking the open view closes the side bar. A badge keeps a
 * storage warning visible while another view is open.
 */
export class ActivityBarComponent extends BaseComponent {
  static tagName = 'activity-bar';
  tabs: HTMLButtonElement[] = [];

  constructor() {
    super(template, style);
  }

  init() {
    this.tabs = [...this.querySelectorAll<HTMLButtonElement>('.activity')];
    for (const tab of this.tabs) {
      tab.addEventListener('click', () =>
        workspaceActions.showView(parseSideView(tab.dataset.view ?? null))
      );
      // Roving focus: arrow keys move between tabs, wrapping.
      tab.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const i = this.tabs.indexOf(tab);
        this.tabs[(i + step + this.tabs.length) % this.tabs.length].focus();
      });
    }
    this.render(uiStore.getState());
    uiStore.addEventListener('change', ((e: CustomEvent<UiState>) =>
      this.render(e.detail)) as EventListener);
    this.renderBadge(storageStore.getState());
    storageStore.addEventListener('change', ((
      e: CustomEvent<StorageStoreState>
    ) => this.renderBadge(e.detail)) as EventListener);
  }

  render({ explorerOpen, sideView }: UiState) {
    for (const tab of this.tabs) {
      const selected = tab.dataset.view === sideView;
      tab.setAttribute('aria-selected', String(explorerOpen && selected));
      // The current view is the one Tab lands on.
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  renderBadge({ health }: StorageStoreState) {
    const warn = health?.level === 'warn';
    const tab = this.tabs.find((t) => t.dataset.view === 'storage')!;
    tab.querySelector<HTMLElement>('.activity-badge')!.hidden = !warn;
    tab.querySelector('.activity-name')!.textContent = warn
      ? 'Storage (needs attention)'
      : 'Storage';
  }
}

if (!customElements.get(ActivityBarComponent.tagName)) {
  customElements.define(ActivityBarComponent.tagName, ActivityBarComponent);
}
