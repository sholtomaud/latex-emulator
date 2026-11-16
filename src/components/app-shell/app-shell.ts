import { BaseComponent } from '../../core/base-component.ts';
import '../activity-bar/activity-bar.ts';
import '../assistant-panel/assistant-panel.ts';
import '../download-menu/download-menu.ts';
import '../document-explorer/document-explorer.ts';
import '../latex-editor/latex-editor.ts';
import { isPrintShortcut } from '../latex-preview/latex-preview.ts';
import { requestPrint } from '../../store/print-requests.ts';
import { updateStore } from '../../store/update-store.ts';
import type { UpdateState } from '../../store/update-store.ts';
import { uiStore } from '../../store/ui-store.ts';
import type { UiState } from '../../store/ui-store.ts';
import { workspaceStore } from '../../store/workspace-store.ts';
import type { WorkspaceStoreState } from '../../store/workspace-store.ts';
import {
  startWorkspace,
  workspaceActions,
} from '../../workspace/workspace-service.ts';
import {
  isToggleAssistantShortcut,
  isToggleExplorerShortcut,
} from '../../util/shortcuts.ts';
import template from './app-shell.html?raw';
import style from './app-shell.css?raw';

/**
 * Top-level layout: toolbar, then activity bar | side bar | editor |
 * preview | assistant (ADR 0022).
 */
export class AppShellComponent extends BaseComponent {
  static tagName = 'app-shell';

  constructor() {
    super(template, style);
  }

  init() {
    const explorer = this.querySelector<HTMLElement>('document-explorer')!;
    const toggle = this.querySelector<HTMLButtonElement>('.explorer-toggle')!;
    const docName = this.querySelector<HTMLElement>('.doc-name')!;

    const panes = this.querySelector<HTMLElement>('.panes')!;
    const showExplorer = ({ explorerOpen }: UiState) => {
      explorer.hidden = !explorerOpen;
      panes.classList.toggle('with-explorer', explorerOpen);
      toggle.setAttribute('aria-expanded', String(explorerOpen));
    };
    const assistant = this.querySelector<HTMLElement>('assistant-panel')!;
    const showAssistant = ({ assistantOpen }: UiState) => {
      assistant.hidden = !assistantOpen;
      panes.classList.toggle('with-assistant', assistantOpen);
    };
    const notice = this.querySelector<HTMLElement>('.app-notice')!;
    const showNotice = ({ notice: text }: UiState) => {
      notice.textContent = text;
      notice.hidden = !text;
    };
    // A release downloaded in the background (ADR 0021): reload on request,
    // after saving (the reload's pagehide flushes the editor).
    const update = this.querySelector<HTMLElement>('.app-update')!;
    const showUpdate = ({ apply }: UpdateState) => {
      update.hidden = !apply;
    };
    this.querySelector('.app-update-button')!.addEventListener('click', () =>
      updateStore.getState().apply?.()
    );
    showUpdate(updateStore.getState());
    updateStore.addEventListener('change', ((e: CustomEvent<UpdateState>) =>
      showUpdate(e.detail)) as EventListener);

    showExplorer(uiStore.getState());
    showAssistant(uiStore.getState());
    showNotice(uiStore.getState());
    uiStore.addEventListener('change', ((e: CustomEvent<UiState>) => {
      showExplorer(e.detail);
      showAssistant(e.detail);
      showNotice(e.detail);
    }) as EventListener);

    workspaceStore.addEventListener('change', ((
      e: CustomEvent<WorkspaceStoreState>
    ) => {
      const active = e.detail.documents.find((d) => d.id === e.detail.activeId);
      docName.textContent = active ? `— ${active.name}` : '';
    }) as EventListener);

    toggle.addEventListener('click', () => workspaceActions.toggleExplorer());

    // Capture phase: the editor handles (and may swallow) its own key events.
    window.addEventListener(
      'keydown',
      (e) => {
        if (isPrintShortcut(e)) {
          e.preventDefault();
          e.stopPropagation();
          requestPrint();
        } else if (isToggleAssistantShortcut(e)) {
          e.preventDefault();
          e.stopPropagation();
          workspaceActions.toggleAssistant();
        } else if (isToggleExplorerShortcut(e)) {
          e.preventDefault();
          e.stopPropagation();
          workspaceActions.toggleExplorer();
        }
      },
      { capture: true }
    );

    void startWorkspace();
  }
}

if (!customElements.get(AppShellComponent.tagName)) {
  customElements.define(AppShellComponent.tagName, AppShellComponent);
}
