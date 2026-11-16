import { BaseComponent } from '../../core/base-component.ts';
import { workspaceActions } from '../../workspace/workspace-service.ts';
import { uiStore } from '../../store/ui-store.ts';
import type { UiState } from '../../store/ui-store.ts';
import { documentStore } from '../../store/document-store.ts';
import { assistant, assistantKeys } from '../../assistant/assistant-service.ts';
import type { AssistantState } from '../../assistant/assistant-controller.ts';
import { PROVIDER_IDS, PROVIDERS } from '../../assistant/providers.ts';
import type { ProviderId } from '../../assistant/providers.ts';
import { splitFences } from '../../assistant/fences.ts';
import { excerptLabel } from '../../assistant/context.ts';
import { editorBridge, requestInsert } from '../../store/editor-bridge.ts';
import type { EditorBridgeState } from '../../store/editor-bridge.ts';
import {
  MAX_WIDTH,
  MIN_WIDTH,
  resizeByKey,
  widthFromPointer,
} from '../../assistant/pane.ts';
import template from './assistant-panel.html?raw';
import style from './assistant-panel.css?raw';

/**
 * The secondary side bar (ADR 0022) holding the writing assistant's chat
 * (ADR 0023): pinned beside the preview or floating over it, resizable from
 * its left edge, with the conversation of the open document. Replies are
 * shown as text (code blocks as code), never as HTML.
 */
export class AssistantPanelComponent extends BaseComponent {
  static tagName = 'assistant-panel';

  constructor() {
    super(template, style);
  }

  init() {
    const $ = <T extends Element>(s: string) => this.querySelector<T>(s)!;
    const close = $<HTMLButtonElement>('.assistant-close');
    const pin = $<HTMLButtonElement>('.assistant-pin');
    const clear = $<HTMLButtonElement>('.assistant-clear');
    const handle = $<HTMLElement>('.assistant-resize');
    const provider = $<HTMLSelectElement>('.assistant-provider');
    const modelName = $<HTMLElement>('.assistant-model-name');
    const read = $<HTMLInputElement>('.assistant-read');
    const consentNote = $<HTMLElement>('.assistant-consent-note');
    const scroll = $<HTMLElement>('.assistant-scroll');
    const empty = $<HTMLElement>('.assistant-empty');
    const list = $<HTMLOListElement>('.assistant-messages');
    const error = $<HTMLElement>('.assistant-error');
    const form = $<HTMLFormElement>('.assistant-composer');
    const input = $<HTMLTextAreaElement>('.assistant-input');
    const send = $<HTMLButtonElement>('.assistant-send');
    const stop = $<HTMLButtonElement>('.assistant-stop');
    const messageTemplate = $<HTMLTemplateElement>('.message-template');
    const codeTemplate = $<HTMLTemplateElement>('.code-template');
    const attachment = $<HTMLElement>('.assistant-attachment');
    const attachmentLabel = $<HTMLElement>('.assistant-attachment-label');
    const askSelection = $<HTMLButtonElement>('.assistant-ask-selection');

    // Ask about the editor's selection (ADR 0023): attach it to the next
    // question, from here or with Ctrl/⌘+Shift+A in the editor.
    $('.assistant-attachment-remove').addEventListener('click', () => {
      assistant.attach(null);
      input.focus();
    });
    askSelection.addEventListener('click', () => {
      const { selection } = editorBridge.getState();
      if (selection) assistant.attach(selection, { focus: true });
    });
    assistant.store.addEventListener('focus-composer', () => input.focus());

    // Insert a suggested block at the cursor, replacing the selection.
    const showInsert = (button: HTMLButtonElement) => {
      const replace = !!editorBridge.getState().selection;
      button.textContent = replace ? 'Replace selection' : 'Insert';
      button.setAttribute(
        'aria-label',
        replace
          ? 'Replace the selection with this code'
          : 'Insert this code at the cursor'
      );
      button.disabled = uiStore.getState().readOnly;
    };
    const showSelection = ({ selection }: EditorBridgeState) => {
      askSelection.hidden = !selection;
      if (selection)
        askSelection.textContent = `Ask about the selection (${excerptLabel(selection)})`;
      for (const b of list.querySelectorAll<HTMLButtonElement>('.code-insert'))
        showInsert(b);
    };

    close.addEventListener('click', () => {
      workspaceActions.closeAssistant();
      // The panel is gone: give focus back to the button that opens it.
      document.querySelector<HTMLElement>('.assistant-toggle')?.focus();
    });
    pin.addEventListener('click', () =>
      workspaceActions.setAssistantPinned(!uiStore.getState().assistantPinned)
    );
    clear.addEventListener('click', () => void assistant.clear());
    $('.assistant-setup-open').addEventListener('click', () => {
      const ui = uiStore.getState();
      if (!ui.explorerOpen || ui.sideView !== 'assistant')
        workspaceActions.showView('assistant');
    });

    // The left edge: drag it, or use the arrow keys (a window splitter).
    const setWidth = (w: number) => workspaceActions.setAssistantWidth(w);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) =>
        setWidth(widthFromPointer(ev.clientX, window.innerWidth));
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('keydown', (e) => {
      const w = resizeByKey(
        e.key,
        uiStore.getState().assistantWidth,
        window.innerWidth
      );
      if (w === null) return;
      e.preventDefault();
      setWidth(w);
    });
    handle.setAttribute('aria-valuemin', String(MIN_WIDTH));
    handle.setAttribute('aria-valuemax', String(MAX_WIDTH));

    const showPane = ({ assistantPinned, assistantWidth }: UiState) => {
      pin.setAttribute('aria-pressed', String(assistantPinned));
      pin.title = assistantPinned
        ? 'Pinned beside the preview. Unpin to float over it.'
        : 'Floating over the preview; it closes when you go back to the editor. Pin it to keep it beside the preview.';
      handle.setAttribute('aria-valuenow', String(assistantWidth));
    };
    showPane(uiStore.getState());
    uiStore.addEventListener('change', ((e: CustomEvent<UiState>) =>
      showPane(e.detail)) as EventListener);

    for (const id of PROVIDER_IDS) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = PROVIDERS[id].name;
      provider.append(option);
    }
    provider.addEventListener('change', () =>
      assistant.setProvider(provider.value as ProviderId)
    );
    read.addEventListener('change', () => assistant.allowReading(read.checked));

    const submit = () => {
      const text = input.value;
      if (!text.trim()) return;
      input.value = '';
      void assistant.send(text, documentStore.getState().source);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    stop.addEventListener('click', () => assistant.stop());

    const renderBody = (
      body: HTMLElement,
      text: string,
      role: 'user' | 'assistant'
    ) => {
      body.replaceChildren();
      for (const seg of splitFences(text)) {
        if (seg.kind === 'text') {
          const p = document.createElement('div');
          p.className = 'message-text';
          p.textContent = seg.text.replace(/^\n+|\n+$/g, '');
          if (p.textContent) body.append(p);
          continue;
        }
        const block = codeTemplate.content.firstElementChild!.cloneNode(
          true
        ) as HTMLElement;
        block.querySelector('code')!.textContent = seg.text;
        if (seg.lang) block.dataset.lang = seg.lang;
        const insert = block.querySelector<HTMLButtonElement>('.code-insert')!;
        if (role === 'user') insert.remove();
        else {
          showInsert(insert);
          insert.addEventListener('click', () => requestInsert(seg.text));
        }
        const copy = block.querySelector<HTMLButtonElement>('.code-copy')!;
        copy.setAttribute('aria-label', 'Copy code');
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(seg.text).then(
            () => (copy.textContent = 'Copied'),
            () => (copy.textContent = 'Copy failed')
          );
        });
        body.append(block);
      }
    };

    let lastDraft = '';
    const render = (s: AssistantState) => {
      const p = s.settings.provider;
      provider.value = p;
      const cfg = assistant.config(p);
      modelName.textContent = cfg.model || 'server’s model';
      modelName.title = cfg.model;
      read.checked = s.mayRead;
      read.disabled = !s.documentId;
      consentNote.textContent = s.mayRead
        ? `Each message sends this document’s source to ${PROVIDERS[p].name}.`
        : 'Only your messages are sent, not the document.';
      // Keep the view at the bottom while a reply arrives, unless the
      // reader has scrolled up.
      const atBottom =
        scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 24;
      const items = [...list.children] as HTMLElement[];
      s.messages.forEach((m, i) => {
        let li = items[i];
        if (!li) {
          li = messageTemplate.content.firstElementChild!.cloneNode(
            true
          ) as HTMLElement;
          list.append(li);
        }
        li.className = `message ${m.role}`;
        li.querySelector('.message-role')!.textContent =
          m.role === 'user' ? 'You' : 'Assistant';
        const body = li.querySelector<HTMLElement>('.message-body')!;
        if (body.dataset.text !== m.content) {
          body.dataset.text = m.content;
          renderBody(body, m.content, m.role);
        }
      });
      for (const extra of items.slice(s.messages.length)) extra.remove();
      empty.hidden = s.messages.length > 0;
      list.setAttribute('aria-busy', String(s.streaming));
      error.textContent = s.error;
      error.hidden = !s.error;
      send.hidden = s.streaming;
      stop.hidden = !s.streaming;
      clear.disabled = s.streaming || s.messages.length === 0;
      if (s.draft && s.draft !== lastDraft && !input.value)
        input.value = s.draft;
      lastDraft = s.draft;
      attachment.hidden = !s.attachment;
      attachmentLabel.textContent = s.attachment
        ? `Asking about ${excerptLabel(s.attachment)}; they are sent with your question.`
        : '';
      if (atBottom) scroll.scrollTop = scroll.scrollHeight;
    };
    showSelection(editorBridge.getState());
    editorBridge.addEventListener('change', ((
      e: CustomEvent<EditorBridgeState>
    ) => showSelection(e.detail)) as EventListener);
    uiStore.addEventListener('change', () =>
      showSelection(editorBridge.getState())
    );
    render(assistant.store.getState());
    assistant.store.addEventListener('change', ((
      e: CustomEvent<AssistantState>
    ) => render(e.detail)) as EventListener);
    // A key added or removed changes nothing shown, but the model name may.
    assistantKeys.addEventListener('change', () =>
      render(assistant.store.getState())
    );
  }
}

if (!customElements.get(AssistantPanelComponent.tagName)) {
  customElements.define(
    AssistantPanelComponent.tagName,
    AssistantPanelComponent
  );
}
