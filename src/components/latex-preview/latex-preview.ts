import { BaseComponent } from '../../core/base-component.ts';
import { documentStore } from '../../store/document-store.ts';
import type { DocumentState } from '../../store/document-store.ts';
import { toPlainParagraphs } from '../../render/plain-text.ts';
import { fitScale } from '../../render/fit-scale.ts';
import { debounce } from '../../util/debounce.ts';
import documentCss from '../../styles/document/base.css?raw';
import template from './latex-preview.html?raw';
import style from './latex-preview.css?raw';

const PREVIEW_DEBOUNCE_MS = 150;
/** Space kept around the page in the preview, in CSS px. */
const PAGE_GUTTER_PX = 24;

/**
 * Renders the document into a same-origin <iframe>. The iframe holds only the
 * document and its own stylesheet (no app chrome, no Tailwind), so it can later
 * be printed directly to produce the PDF (AGENTS.md §4, decision 4).
 */
export class LatexPreviewComponent extends BaseComponent {
  static tagName = 'latex-preview';
  frame!: HTMLIFrameElement;
  page: HTMLElement | null = null;

  constructor() {
    super(template, style);
  }

  init() {
    this.frame = this.querySelector('iframe')!;
    this.setUpFrameDocument();
    this.render(documentStore.getState().source);

    const renderLater = debounce(
      (source: string) => this.render(source),
      PREVIEW_DEBOUNCE_MS
    );
    new ResizeObserver(() => this.fitToPane()).observe(this.frame);

    documentStore.addEventListener('change', ((e: CustomEvent<DocumentState>) =>
      renderLater(e.detail.source)) as EventListener);
  }

  /** Build the iframe's document skeleton with DOM APIs (never innerHTML). */
  setUpFrameDocument() {
    const doc = this.frame.contentDocument;
    if (!doc) return;

    doc.documentElement.lang = 'en';
    doc.title = 'document';

    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    const styleEl = doc.createElement('style');
    styleEl.textContent = documentCss;
    doc.head.replaceChildren(charset, styleEl);

    this.page = doc.createElement('article');
    this.page.className = 'latex-page';
    doc.body.replaceChildren(this.page);
  }

  /**
   * Zoom the screen preview so the whole page width is visible. Print is
   * unaffected: `zoom` is reset under `@media print` in the document CSS.
   */
  fitToPane() {
    if (!this.page) return;
    const root = this.page.ownerDocument.documentElement;
    root.style.removeProperty('--preview-zoom');
    const scale = fitScale(
      this.frame.clientWidth,
      this.page.offsetWidth,
      PAGE_GUTTER_PX
    );
    root.style.setProperty('--preview-zoom', String(scale));
  }

  render(source: string) {
    if (!this.page) return;
    const doc = this.page.ownerDocument;
    const paragraphs = toPlainParagraphs(source).map((text) => {
      const p = doc.createElement('p');
      p.textContent = text;
      return p;
    });
    this.page.replaceChildren(...paragraphs);
  }
}

if (!customElements.get(LatexPreviewComponent.tagName)) {
  customElements.define(LatexPreviewComponent.tagName, LatexPreviewComponent);
}
