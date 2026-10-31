import { BaseComponent } from '../../core/base-component.ts';
import { documentStore } from '../../store/document-store.ts';
import type { DocumentState } from '../../store/document-store.ts';
import { printRequests } from '../../store/print-requests.ts';
import type { PrintJob } from '../../store/print-requests.ts';
import { diagnosticsStore } from '../../store/diagnostics-store.ts';
import { renderDocument } from '../../render/render-document.ts';
import { toDom } from '../../render/to-dom.ts';
import {
  fontFaceCss,
  geometryCss,
  preprintCss,
} from '../../render/document-css.ts';
import type { ArticleGeometry } from '../../latex/classes/article.ts';
import { FONT_URLS } from '../../render/fonts.ts';
import { fitScale } from '../../render/fit-scale.ts';
import { debounce } from '../../util/debounce.ts';
import documentCss from '../../styles/document/base.css?raw';
import template from './latex-preview.html?raw';
import style from './latex-preview.css?raw';

const PREVIEW_DEBOUNCE_MS = 150;
/** Space kept around the page in the preview, in CSS px. */
const PAGE_GUTTER_PX = 24;

/**
 * Renders the document into a same-origin <iframe> holding only the document
 * and its own stylesheets (no app chrome, no Tailwind). Printing that iframe
 * produces the PDF (AGENTS.md §4, decision 4).
 */
export class LatexPreviewComponent extends BaseComponent {
  static tagName = 'latex-preview';
  frame!: HTMLIFrameElement;
  page: HTMLElement | null = null;
  geometryStyle: HTMLStyleElement | null = null;
  preprintStyle: HTMLStyleElement | null = null;
  geometry: ArticleGeometry | null = null;
  title = 'document';

  constructor() {
    super(template, style);
  }

  init() {
    this.frame = this.querySelector('iframe')!;
    this.setUpFrameDocument();
    this.render(documentStore.getState().source);

    // Layout changes are deferred a frame so observers never re-trigger
    // themselves within one frame ("ResizeObserver loop" errors).
    new ResizeObserver(() =>
      requestAnimationFrame(() => this.fitToPane())
    ).observe(this.frame);
    new ResizeObserver(() =>
      requestAnimationFrame(() => this.trackPageHeight())
    ).observe(this.page!);

    const renderLater = debounce(
      (source: string) => this.render(source),
      PREVIEW_DEBOUNCE_MS
    );
    documentStore.addEventListener('change', ((e: CustomEvent<DocumentState>) =>
      renderLater(e.detail.source)) as EventListener);
    printRequests.addEventListener(
      'print',
      (e) => void this.print((e as CustomEvent<PrintJob>).detail)
    );
  }

  /** Build the iframe's document skeleton with DOM APIs (never innerHTML). */
  setUpFrameDocument() {
    const doc = this.frame.contentDocument;
    if (!doc) return;

    doc.documentElement.lang = 'en';
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    const fonts = doc.createElement('style');
    fonts.textContent = fontFaceCss(FONT_URLS);
    this.geometryStyle = doc.createElement('style');
    const base = doc.createElement('style');
    base.textContent = documentCss;
    // Filled only while printing a preprint.
    this.preprintStyle = doc.createElement('style');
    this.preprintStyle.dataset.preprint = '';
    doc.head.replaceChildren(
      charset,
      fonts,
      this.geometryStyle,
      base,
      this.preprintStyle
    );

    this.page = doc.createElement('div');
    this.page.className = 'latex-page';
    doc.body.replaceChildren(this.page);

    // Cmd/Ctrl+P while the preview has focus prints the document too.
    this.frame.contentWindow?.addEventListener('keydown', (e) => {
      if (isPrintShortcut(e)) {
        e.preventDefault();
        void this.print();
      }
    });
  }

  /**
   * Scale the screen preview so the whole page width is visible. The page is
   * still laid out at full size (a transform, not `zoom`), so its line breaks
   * are the PDF's. Print resets the transform in the document CSS.
   */
  fitToPane() {
    if (!this.page) return;
    const root = this.page.ownerDocument.documentElement;
    // offsetWidth ignores transforms: it is the full-size page width.
    const scale = fitScale(
      this.frame.clientWidth,
      this.page.offsetWidth,
      PAGE_GUTTER_PX
    );
    root.style.setProperty('--preview-zoom', String(scale));
  }

  /** The scaled page's layout height, so the margin can give back the space. */
  trackPageHeight() {
    if (!this.page) return;
    this.page.ownerDocument.documentElement.style.setProperty(
      '--page-height',
      `${this.page.offsetHeight}px`
    );
  }

  render(source: string) {
    if (!this.page) return;
    const result = renderDocument(source);
    this.geometry = result.geometry;
    const css = geometryCss(result.geometry);
    if (this.geometryStyle && this.geometryStyle.textContent !== css) {
      this.geometryStyle.textContent = css;
      queueMicrotask(() => this.fitToPane());
    }
    this.title = result.title || 'document';
    diagnosticsStore.setState({ source, diagnostics: result.diagnostics });
    this.page.replaceChildren(toDom(result.tree, this.page.ownerDocument));
  }

  /**
   * Print only the document; Chromium names the PDF after the iframe's title.
   * A job can print another source (a saved version) with a preprint stamp;
   * the preview is restored afterwards.
   */
  async print(job: PrintJob = {}) {
    const win = this.frame.contentWindow;
    const doc = this.frame.contentDocument;
    if (!win || !doc) return;
    const other = job.source !== undefined;
    if (other) this.render(job.source!);
    if (job.stamp && this.geometry && this.preprintStyle)
      this.preprintStyle.textContent = preprintCss(job.stamp, this.geometry);
    doc.title = job.title ?? this.title;
    await doc.fonts.ready;
    win.focus();
    try {
      win.print(); // blocks until the print dialog closes
    } finally {
      if (this.preprintStyle) this.preprintStyle.textContent = '';
      if (other) this.render(documentStore.getState().source);
    }
  }
}

export function isPrintShortcut(e: KeyboardEvent): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    e.key.toLowerCase() === 'p'
  );
}

if (!customElements.get(LatexPreviewComponent.tagName)) {
  customElements.define(LatexPreviewComponent.tagName, LatexPreviewComponent);
}
