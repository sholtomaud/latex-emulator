import { BaseComponent } from '../../core/base-component.ts';
import { imageStore } from '../../store/image-store.ts';
import type { ImageStoreState } from '../../store/image-store.ts';
import { workspaceStore } from '../../store/workspace-store.ts';
import { workspaceActions } from '../../workspace/workspace-service.ts';
import type { ImageMeta } from '../../workspace/image-library.ts';
import { describeImage, includeSnippet } from '../../images/describe.ts';
import template from './image-panel.html?raw';
import style from './image-panel.css?raw';

/**
 * The open document's images (ADR 0013): add by picker, drag-and-drop or
 * paste; copy an \includegraphics line; rename, download, delete; and
 * reuse images from other documents without copying them.
 */
export class ImagePanelComponent extends BaseComponent {
  static tagName = 'image-panel';
  list!: HTMLUListElement;
  reuseList!: HTMLUListElement;
  /** Image being renamed; re-renders leave its input alone. */
  renaming: string | null = null;

  constructor() {
    super(template, style);
  }

  init() {
    this.list = this.querySelector('.image-list')!;
    this.reuseList = this.querySelector('.reuse-list')!;
    const input = this.querySelector<HTMLInputElement>('.add-image-input')!;
    this.querySelector('.add-image')!.addEventListener('click', () =>
      input.click()
    );
    input.addEventListener('change', async () => {
      await this.add([...(input.files ?? [])]);
      input.value = '';
    });

    const section = this.querySelector<HTMLElement>('.images')!;
    section.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      section.classList.add('dragging');
    });
    section.addEventListener('dragleave', () =>
      section.classList.remove('dragging')
    );
    section.addEventListener('drop', (e) => {
      e.preventDefault();
      section.classList.remove('dragging');
      void this.add([...(e.dataTransfer?.files ?? [])]);
    });
    // Pasting an image anywhere in the app adds it to the open document
    // (text pastes are left alone).
    window.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
        /^image\/|^application\/pdf$/.test(f.type)
      );
      if (!files.length) return;
      e.preventDefault();
      void workspaceActions.addImages(
        files.map((f) => ({ name: pastedName(f), blob: f }))
      );
    });

    this.render(imageStore.getState());
    imageStore.addEventListener('change', ((e: CustomEvent<ImageStoreState>) =>
      this.render(e.detail)) as EventListener);
    // Document names label the reuse list.
    workspaceStore.addEventListener('change', () =>
      this.render(imageStore.getState())
    );
  }

  add(files: File[]) {
    return workspaceActions.addImages(
      files.map((f) => ({ name: f.name, blob: f }))
    );
  }

  render(state: ImageStoreState) {
    const { images, elsewhere, status, documentId } = state;
    this.list.replaceChildren(...images.map((m) => this.renderImage(m)));
    this.querySelector<HTMLElement>('.image-empty')!.hidden =
      images.length > 0 || documentId === null;
    this.querySelector('.image-status')!.textContent = status;

    const names = new Map(
      workspaceStore.getState().documents.map((d) => [d.id, d.name])
    );
    const reuse = this.querySelector<HTMLDetailsElement>('.image-reuse')!;
    reuse.hidden = elsewhere.length === 0;
    const template = this.querySelector<HTMLTemplateElement>(
      '.reuse-item-template'
    )!;
    this.reuseList.replaceChildren(
      ...elsewhere.map((e) => {
        const li = (template.content.cloneNode(true) as DocumentFragment)
          .firstElementChild as HTMLLIElement;
        li.querySelector('.image-name')!.textContent = e.name;
        li.querySelector('.image-meta')!.textContent =
          `in ${names.get(e.documentId) ?? 'another document'}`;
        const add = li.querySelector<HTMLButtonElement>('.reuse-add')!;
        add.setAttribute('aria-label', `Add ${e.name} to this document`);
        add.addEventListener('click', () => workspaceActions.reuseImage(e.id));
        return li;
      })
    );
  }

  renderImage(m: ImageMeta): HTMLLIElement {
    const template = this.querySelector<HTMLTemplateElement>(
      '.image-item-template'
    )!;
    const li = (template.content.cloneNode(true) as DocumentFragment)
      .firstElementChild as HTMLLIElement;
    li.title = includeSnippet(m.name);
    li.querySelector('.image-name')!.textContent = m.name;
    li.querySelector('.image-meta')!.textContent = describeImage(
      m.info,
      m.bytes
    );
    const button = (cls: string, label: string, title: string) => {
      const b = li.querySelector<HTMLButtonElement>(cls)!;
      b.setAttribute('aria-label', `${label} ${m.name}`);
      b.title = title;
      return b;
    };
    button(
      '.image-copy',
      'Copy \\includegraphics for',
      'Copy \\includegraphics'
    ).addEventListener('click', () => void this.copy(m.name));
    button('.image-rename', 'Rename', 'Rename').addEventListener('click', () =>
      this.startRename(li, m.name)
    );
    button('.image-download', 'Download', 'Download').addEventListener(
      'click',
      () => workspaceActions.downloadImage(m.name)
    );
    button('.image-delete', 'Delete', 'Delete').addEventListener(
      'click',
      () => {
        if (confirm(`Delete ${m.name} from this document?`))
          void workspaceActions.deleteImage(m.name);
      }
    );
    if (this.renaming === m.name)
      queueMicrotask(() => this.startRename(li, m.name));
    return li;
  }

  async copy(name: string) {
    const text = includeSnippet(name);
    try {
      await navigator.clipboard.writeText(text);
      imageStore.setState({ status: `Copied ${text}` });
    } catch {
      imageStore.setState({ status: `Use ${text}` });
    }
  }

  startRename(li: HTMLLIElement, name: string) {
    this.renaming = name;
    const template = this.querySelector<HTMLTemplateElement>(
      '.image-rename-template'
    )!;
    const input = (template.content.cloneNode(true) as DocumentFragment)
      .firstElementChild as HTMLInputElement;
    input.value = name;
    const label = li.querySelector('.image-name')!;
    label.replaceWith(input);
    input.focus();
    input.setSelectionRange(
      0,
      name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length
    );
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (commit && input.value.trim() && input.value.trim() !== name)
        await workspaceActions.renameImage(name, input.value);
      this.render(imageStore.getState());
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void finish(true);
      if (e.key === 'Escape') void finish(false);
    });
    input.addEventListener('blur', () => void finish(true));
  }
}

/** A pasted screenshot is named "image.png" by browsers: let the library name it. */
function pastedName(f: File): string | null {
  return /^image\.\w+$/.test(f.name) || !f.name ? null : f.name;
}

if (!customElements.get(ImagePanelComponent.tagName)) {
  customElements.define(ImagePanelComponent.tagName, ImagePanelComponent);
}
