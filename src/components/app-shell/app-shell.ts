import { BaseComponent } from '../../core/base-component.ts';
import '../latex-editor/latex-editor.ts';
import '../latex-preview/latex-preview.ts';
import template from './app-shell.html?raw';
import style from './app-shell.css?raw';

/** Top-level layout: toolbar, then an editor | preview split. */
export class AppShellComponent extends BaseComponent {
  static tagName = 'app-shell';

  constructor() {
    super(template, style);
  }
}

if (!customElements.get(AppShellComponent.tagName)) {
  customElements.define(AppShellComponent.tagName, AppShellComponent);
}
