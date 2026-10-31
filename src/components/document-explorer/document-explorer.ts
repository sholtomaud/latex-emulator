import { BaseComponent } from '../../core/base-component.ts';
import { workspaceStore } from '../../store/workspace-store.ts';
import type { WorkspaceStoreState } from '../../store/workspace-store.ts';
import { workspaceActions } from '../../workspace/workspace-service.ts';
import type { DocumentMeta } from '../../workspace/workspace.ts';
import template from './document-explorer.html?raw';
import style from './document-explorer.css?raw';

/** The left-hand document list: open, create, import, rename, download, delete. */
export class DocumentExplorerComponent extends BaseComponent {
  static tagName = 'document-explorer';
  list!: HTMLUListElement;
  itemTemplate!: HTMLTemplateElement;
  renameTemplate!: HTMLTemplateElement;
  /** Document being renamed; re-renders leave its input alone. */
  renaming: string | null = null;

  constructor() {
    super(template, style);
  }

  init() {
    this.list = this.querySelector('.doc-list')!;
    this.itemTemplate = this.querySelector('.doc-item-template')!;
    this.renameTemplate = this.querySelector('.doc-rename-template')!;
    const input = this.querySelector<HTMLInputElement>('.import-input')!;

    this.querySelector('.new-doc')!.addEventListener('click', () =>
      workspaceActions.create()
    );
    this.querySelector('.import-doc')!.addEventListener('click', () =>
      input.click()
    );
    input.addEventListener('change', async () => {
      for (const file of input.files ?? [])
        await workspaceActions.importFile(file);
      input.value = '';
    });

    this.render(workspaceStore.getState());
    workspaceStore.addEventListener('change', ((
      e: CustomEvent<WorkspaceStoreState>
    ) => this.render(e.detail)) as EventListener);
  }

  render({ documents, activeId }: WorkspaceStoreState) {
    const items = documents.map((doc) =>
      this.renderItem(doc, doc.id === activeId)
    );
    this.list.replaceChildren(...items);
  }

  renderItem(doc: DocumentMeta, active: boolean): HTMLLIElement {
    const li = (this.itemTemplate.content.cloneNode(true) as DocumentFragment)
      .firstElementChild as HTMLLIElement;
    const open = li.querySelector<HTMLButtonElement>('.doc-open')!;
    open.textContent = doc.name;
    open.title = doc.name;
    if (active) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => workspaceActions.open(doc.id));
    open.addEventListener('dblclick', () => this.startRename(li, doc));

    const label = (button: string, text: string) => {
      const el = li.querySelector<HTMLButtonElement>(button)!;
      el.setAttribute('aria-label', `${text} ${doc.name}`);
      el.title = text;
      return el;
    };
    label('.doc-rename', 'Rename').addEventListener('click', () =>
      this.startRename(li, doc)
    );
    label('.doc-download', 'Download').addEventListener('click', () =>
      workspaceActions.download(doc.id)
    );
    label('.doc-delete', 'Delete').addEventListener('click', () => {
      if (confirm(`Delete “${doc.name}”? This cannot be undone.`))
        void workspaceActions.delete(doc.id);
    });

    if (this.renaming === doc.id) this.startRename(li, doc);
    return li;
  }

  /** Swap the name for an input: Enter or blur saves, Escape cancels. */
  startRename(li: HTMLLIElement, doc: DocumentMeta) {
    this.renaming = doc.id;
    const input = (
      this.renameTemplate.content.cloneNode(true) as DocumentFragment
    ).firstElementChild as HTMLInputElement;
    input.value = doc.name;
    const open = li.querySelector('.doc-open')!;
    open.replaceWith(input);
    li.querySelector<HTMLElement>('.doc-actions')!.hidden = true;
    input.focus();
    input.select();

    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (save) void workspaceActions.rename(doc.id, input.value);
      else this.render(workspaceStore.getState());
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }
}

if (!customElements.get(DocumentExplorerComponent.tagName)) {
  customElements.define(
    DocumentExplorerComponent.tagName,
    DocumentExplorerComponent
  );
}
