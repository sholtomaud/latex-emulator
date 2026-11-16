import { BaseComponent } from '../../core/base-component.ts';
import { workspaceActions } from '../../workspace/workspace-service.ts';
import { requestPrint } from '../../store/print-requests.ts';
import { menuFocusIndex } from '../../util/menu-keys.ts';
import template from './download-menu.html?raw';
import style from './download-menu.css?raw';

/**
 * One Download button with the four downloads in a menu (WAI-ARIA menu
 * button): the toolbar stays minimal, and the choices show when asked for.
 * Ctrl/⌘ P still prints at once (app-shell).
 */
export class DownloadMenuComponent extends BaseComponent {
  static tagName = 'download-menu';
  button!: HTMLButtonElement;
  menu!: HTMLElement;
  items: HTMLButtonElement[] = [];

  constructor() {
    super(template, style);
  }

  init() {
    this.button = this.querySelector('.download-button')!;
    this.menu = this.querySelector('.download-menu')!;
    this.items = [
      ...this.querySelectorAll<HTMLButtonElement>('.download-item'),
    ];
    const actions: Record<string, () => void> = {
      pdf: () => requestPrint(),
      preprint: () => void workspaceActions.preprint(),
      zip: () => void workspaceActions.downloadProject(),
      tex: () => void workspaceActions.download(),
    };

    this.button.addEventListener('click', () =>
      this.menu.hidden ? this.open(0) : this.close(false)
    );
    this.button.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      this.open(e.key === 'ArrowDown' ? 0 : this.items.length - 1);
    });
    for (const item of this.items)
      item.addEventListener('click', () => {
        this.close(true);
        actions[item.dataset.action!]();
      });
    this.menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close(true);
        return;
      }
      if (e.key === 'Tab') return this.close(false);
      const current = this.items.indexOf(
        document.activeElement as HTMLButtonElement
      );
      const next = menuFocusIndex(current, this.items.length, e.key);
      if (next === null) return;
      e.preventDefault();
      this.items[next].focus();
    });
    // A click anywhere else closes it.
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.contains(e.target as Node))
        this.close(false);
    });
  }

  open(focus: number) {
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.items[focus].focus();
  }

  /** Close; `refocus` returns focus to the button (Escape, a choice). */
  close(refocus: boolean) {
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (refocus) this.button.focus();
  }
}

if (!customElements.get(DownloadMenuComponent.tagName)) {
  customElements.define(DownloadMenuComponent.tagName, DownloadMenuComponent);
}
