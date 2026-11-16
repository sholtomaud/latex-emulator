import { html, css } from './template-helpers.ts';

export { html, css };

export class BaseComponent extends HTMLElement {
  template: HTMLTemplateElement;

  constructor(htmlContent: string, cssContent: string) {
    super();
    const tagName = this.tagName.toLowerCase();
    const scopedCss = cssContent.replace(/:host/g, tagName);
    this.template = document.createElement('template');
    this.template.innerHTML = `<style>${scopedCss}</style>${htmlContent}`;
  }

  /** Rendered already: moving the element in the DOM reconnects it. */
  #rendered = false;

  connectedCallback() {
    // Local fix (docs/decisions/0022): render and init once, so moving a
    // component (as the Explorer moves the image panel) doesn't append a
    // second copy of its template and listeners.
    if (this.#rendered) return;
    this.#rendered = true;
    this.appendChild(this.template.content.cloneNode(true));
    this.init();
  }

  init() {}
}
