import { BaseComponent } from '../../core/base-component.ts';
import { documentStore } from '../../store/document-store.ts';
import { diagnosticsStore } from '../../store/diagnostics-store.ts';
import type { DiagnosticsState } from '../../store/diagnostics-store.ts';
import type { LatexEditor } from '../../language/monaco.ts';
import { citationServices } from '../../workspace/workspace-service.ts';
import template from './latex-editor.html?raw';
import style from './latex-editor.css?raw';

/**
 * The LaTeX source editor: Monaco, loaded lazily so the app shell and preview
 * appear before the editor's (large) code arrives. Reads and writes
 * `documentStore.source`; shows `diagnosticsStore` as markers.
 */
export class LatexEditorComponent extends BaseComponent {
  static tagName = 'latex-editor';
  editor: LatexEditor | null = null;

  constructor() {
    super(template, style);
  }

  /** The current source text (also used by tests and future features). */
  get value(): string {
    return this.editor?.getValue() ?? documentStore.getState().source;
  }

  async init() {
    const host = this.querySelector<HTMLElement>('.host')!;
    const { createLatexEditor } = await import('../../language/monaco.ts');
    this.editor = createLatexEditor(
      host,
      documentStore.getState().source,
      (source) => documentStore.setState({ source }),
      citationServices
    );
    host.removeAttribute('data-loading');

    // Another document was opened: show its text.
    documentStore.addEventListener('change', ((e: CustomEvent) => {
      const { source } = e.detail as { source: string };
      if (this.editor && this.editor.getValue() !== source)
        this.editor.setValue(source);
    }) as EventListener);

    const show = ({ source, diagnostics }: DiagnosticsState) =>
      this.editor?.setDiagnostics(source, diagnostics);
    show(diagnosticsStore.getState());
    diagnosticsStore.addEventListener('change', ((
      e: CustomEvent<DiagnosticsState>
    ) => show(e.detail)) as EventListener);
  }
}

if (!customElements.get(LatexEditorComponent.tagName)) {
  customElements.define(LatexEditorComponent.tagName, LatexEditorComponent);
}
