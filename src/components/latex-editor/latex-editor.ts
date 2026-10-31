import { BaseComponent } from '../../core/base-component.ts';
import { documentStore } from '../../store/document-store.ts';
import template from './latex-editor.html?raw';
import style from './latex-editor.css?raw';

/**
 * The LaTeX source editor.
 *
 * Milestone 1 uses a plain <textarea> so the shell, store and preview wiring
 * can be built and tested first. Roadmap step 2 replaces it with Monaco; the
 * contract with the rest of the app (read/write `documentStore.source`) stays
 * the same.
 */
export class LatexEditorComponent extends BaseComponent {
  static tagName = 'latex-editor';
  textarea!: HTMLTextAreaElement;

  constructor() {
    super(template, style);
  }

  init() {
    this.textarea = this.querySelector('textarea')!;
    this.textarea.value = documentStore.getState().source;
    this.textarea.addEventListener('input', () => {
      documentStore.setState({ source: this.textarea.value });
    });
  }
}

if (!customElements.get(LatexEditorComponent.tagName)) {
  customElements.define(LatexEditorComponent.tagName, LatexEditorComponent);
}
