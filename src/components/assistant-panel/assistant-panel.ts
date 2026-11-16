import { BaseComponent } from '../../core/base-component.ts';
import { workspaceActions } from '../../workspace/workspace-service.ts';
import template from './assistant-panel.html?raw';
import style from './assistant-panel.css?raw';

/**
 * The secondary side bar (ADR 0022 phase 3), holding the writing assistant
 * (ADR 0023). For now a shell: what the assistant will do, and a close
 * button. The app shell shows and hides it from `uiStore.assistantOpen`.
 */
export class AssistantPanelComponent extends BaseComponent {
  static tagName = 'assistant-panel';

  constructor() {
    super(template, style);
  }

  init() {
    this.querySelector('.assistant-close')!.addEventListener('click', () => {
      workspaceActions.toggleAssistant();
      // The panel is gone: give focus back to the button that opens it.
      document.querySelector<HTMLElement>('.assistant-toggle')?.focus();
    });
  }
}

if (!customElements.get(AssistantPanelComponent.tagName)) {
  customElements.define(
    AssistantPanelComponent.tagName,
    AssistantPanelComponent
  );
}
