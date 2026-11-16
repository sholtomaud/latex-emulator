import { BaseComponent } from '../../core/base-component.ts';
import { documentStore } from '../../store/document-store.ts';
import { uiStore } from '../../store/ui-store.ts';
import type { UiState } from '../../store/ui-store.ts';
import { diagnosticsStore } from '../../store/diagnostics-store.ts';
import type { DiagnosticsState } from '../../store/diagnostics-store.ts';
import type { LatexEditor } from '../../language/monaco.ts';
import { citationServices } from '../../workspace/workspace-service.ts';
import { editorBridge, editorRequests } from '../../store/editor-bridge.ts';
import { askAboutSelection } from '../../assistant/assistant-service.ts';
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
      citationServices,
      {
        onSelection: (selection) => editorBridge.setState({ selection }),
        onAskAboutSelection: askAboutSelection,
      }
    );
    // The assistant's Insert (ADR 0023); refused while the tab is read-only.
    editorRequests.addEventListener('insert', ((e: CustomEvent<string>) => {
      if (!uiStore.getState().readOnly) this.editor?.insert(e.detail);
    }) as EventListener);
    host.removeAttribute('data-loading');
    // A tab whose edits can no longer be saved stops taking them (ADR 0019).
    const lock = ({ readOnly }: UiState) => this.editor?.setReadOnly(readOnly);
    lock(uiStore.getState());
    uiStore.addEventListener('change', ((e: CustomEvent<UiState>) =>
      lock(e.detail)) as EventListener);

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
