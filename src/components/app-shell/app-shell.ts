import { BaseComponent } from '../../core/base-component.ts';
import '../latex-editor/latex-editor.ts';
import { isPrintShortcut } from '../latex-preview/latex-preview.ts';
import { requestPrint } from '../../store/print-requests.ts';
import template from './app-shell.html?raw';
import style from './app-shell.css?raw';

/** Top-level layout: toolbar (with Download PDF), then an editor | preview split. */
export class AppShellComponent extends BaseComponent {
  static tagName = 'app-shell';

  constructor() {
    super(template, style);
  }

  init() {
    this.querySelector('.print-button')!.addEventListener('click', () =>
      requestPrint()
    );
    // Cmd/Ctrl+P prints the document, not the editor UI around it.
    window.addEventListener('keydown', (e) => {
      if (isPrintShortcut(e)) {
        e.preventDefault();
        requestPrint();
      }
    });
  }
}

if (!customElements.get(AppShellComponent.tagName)) {
  customElements.define(AppShellComponent.tagName, AppShellComponent);
}
