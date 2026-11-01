import { BaseComponent } from '../../core/base-component.ts';
import { workspaceStore } from '../../store/workspace-store.ts';
import type { WorkspaceStoreState } from '../../store/workspace-store.ts';
import { workspaceActions } from '../../workspace/workspace-service.ts';
import type { DocumentMeta, VersionMeta } from '../../workspace/workspace.ts';
import type { Bump } from '../../workspace/versions.ts';
import { shortHash } from '../../workspace/versions.ts';
import { bibStore } from '../../store/bib-store.ts';
import type { BibStoreState } from '../../store/bib-store.ts';
import type { BibFileMeta } from '../../workspace/bib-library.ts';
import template from './document-explorer.html?raw';
import style from './document-explorer.css?raw';

/** The left-hand document list: open, create, import, rename, download, delete. */
export class DocumentExplorerComponent extends BaseComponent {
  static tagName = 'document-explorer';
  list!: HTMLUListElement;
  itemTemplate!: HTMLTemplateElement;
  renameTemplate!: HTMLTemplateElement;
  versionList!: HTMLUListElement;
  versionTemplate!: HTMLTemplateElement;
  versionsEmpty!: HTMLElement;
  bibList!: HTMLUListElement;
  bibTemplate!: HTMLTemplateElement;
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
    this.versionList = this.querySelector('.version-list')!;
    this.versionTemplate = this.querySelector('.version-item-template')!;
    this.versionsEmpty = this.querySelector('.versions-empty')!;
    const bump = this.querySelector<HTMLSelectElement>('.version-bump')!;
    this.querySelector('.save-version')!.addEventListener('click', () =>
      workspaceActions.saveVersion(bump.value as Bump)
    );

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

    this.bibList = this.querySelector('.bib-list')!;
    this.bibTemplate = this.querySelector('.bib-item-template')!;
    const bibInput = this.querySelector<HTMLInputElement>('.import-bib-input')!;
    this.querySelector('.import-bib')!.addEventListener('click', () =>
      bibInput.click()
    );
    bibInput.addEventListener('change', async () => {
      for (const file of bibInput.files ?? [])
        await workspaceActions.importBib(file);
      bibInput.value = '';
    });
    this.renderBib(bibStore.getState());
    bibStore.addEventListener('change', ((e: CustomEvent<BibStoreState>) =>
      this.renderBib(e.detail)) as EventListener);

    this.render(workspaceStore.getState());
    workspaceStore.addEventListener('change', ((
      e: CustomEvent<WorkspaceStoreState>
    ) => this.render(e.detail)) as EventListener);
  }

  render({ documents, activeId, versions }: WorkspaceStoreState) {
    const items = documents.map((doc) =>
      this.renderItem(doc, doc.id === activeId)
    );
    this.list.replaceChildren(...items);
    this.versionList.replaceChildren(
      ...versions.map((v) => this.renderVersion(v))
    );
    this.versionsEmpty.hidden = versions.length > 0;
  }

  renderBib({ files, status }: BibStoreState) {
    this.bibList.replaceChildren(...files.map((f) => this.renderBibFile(f)));
    this.querySelector<HTMLElement>('.bib-empty')!.hidden = files.length > 0;
    this.querySelector('.bib-status')!.textContent = status;
  }

  renderBibFile(f: BibFileMeta): HTMLLIElement {
    const li = (this.bibTemplate.content.cloneNode(true) as DocumentFragment)
      .firstElementChild as HTMLLIElement;
    const fileName = `${f.name}.bib`;
    li.title = `\\bibliography{${f.name}}`;
    li.querySelector('.bib-name')!.textContent = fileName;
    li.querySelector('.bib-meta')!.textContent =
      `${f.entries} ${f.entries === 1 ? 'entry' : 'entries'}`;
    const download = li.querySelector<HTMLButtonElement>('.bib-download')!;
    download.setAttribute('aria-label', `Download ${fileName}`);
    download.title = 'Download';
    download.addEventListener('click', () =>
      workspaceActions.downloadBib(f.name)
    );
    const del = li.querySelector<HTMLButtonElement>('.bib-delete')!;
    del.setAttribute('aria-label', `Delete ${fileName}`);
    del.title = 'Delete';
    del.addEventListener('click', () => {
      if (confirm(`Delete ${fileName}? This cannot be undone.`))
        void workspaceActions.deleteBib(f.name);
    });
    return li;
  }

  renderVersion(v: VersionMeta): HTMLLIElement {
    const li = (
      this.versionTemplate.content.cloneNode(true) as DocumentFragment
    ).firstElementChild as HTMLLIElement;
    li.title = `v${v.version} — SHA-256 ${v.sha256}`;
    li.querySelector('.version-label')!.textContent = `v${v.version}`;
    const time = li.querySelector('time')!;
    time.dateTime = new Date(v.createdAt).toISOString();
    time.textContent = new Date(v.createdAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    li.querySelector('.version-hash')!.textContent = shortHash(v.sha256);
    const download = li.querySelector<HTMLButtonElement>('.version-download')!;
    download.setAttribute('aria-label', `Download v${v.version} .tex`);
    download.title = 'Download this version as .tex';
    download.addEventListener('click', () =>
      workspaceActions.downloadVersion(v.id)
    );
    const preprint = li.querySelector<HTMLButtonElement>('.version-preprint')!;
    preprint.setAttribute('aria-label', `Preprint v${v.version}`);
    preprint.title = 'Download this version as a preprint PDF';
    preprint.addEventListener('click', () => workspaceActions.preprint(v.id));
    return li;
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
