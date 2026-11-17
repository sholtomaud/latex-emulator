import { BaseComponent } from '../../core/base-component.ts';
import { comments } from '../../comments/comments-service.ts';
import type { CommentsState } from '../../comments/comments-controller.ts';
import type { Thread } from '../../comments/threads.ts';
import { requestReveal } from '../../store/editor-bridge.ts';
import template from './comments-panel.html?raw';
import style from './comments-panel.css?raw';

const short = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
};

/**
 * The Comments view (ADR 0025): the open document's threads, open ones
 * first. Write a comment on the selection, reply, resolve or reopen, and
 * click a quote to select its text in the editor. Text only, never HTML.
 */
export class CommentsPanelComponent extends BaseComponent {
  static tagName = 'comments-panel';

  constructor() {
    super(template, style);
  }

  init() {
    const $ = <T extends Element>(s: string) => this.querySelector<T>(s)!;
    const draft = $<HTMLFormElement>('.comment-draft');
    const draftQuote = $<HTMLElement>('.draft-quote');
    const draftInput = $<HTMLTextAreaElement>('.draft-input');
    const empty = $<HTMLElement>('.comments-empty');
    const list = $<HTMLOListElement>('.comment-threads');
    const threadTpl = $<HTMLTemplateElement>('.thread-template');
    const messageTpl = $<HTMLTemplateElement>('.message-template');

    const submitDraft = () => void comments.addDraft(draftInput.value);
    draft.addEventListener('submit', (e) => {
      e.preventDefault();
      submitDraft();
    });
    draftInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitDraft();
      }
      if (e.key === 'Escape') comments.cancelDraft();
    });
    $('.draft-cancel').addEventListener('click', () => comments.cancelDraft());

    const renderThread = (t: Thread, focused: boolean) => {
      const li = threadTpl.content.firstElementChild!.cloneNode(
        true
      ) as HTMLElement;
      li.dataset.thread = t.id;
      li.classList.toggle('resolved', t.status === 'resolved');
      li.classList.toggle('focused', focused);
      li.setAttribute(
        'aria-label',
        `Comment on “${short(t.anchor.quote)}”${t.status === 'resolved' ? ', resolved' : ''}`
      );
      const lost = comments.isLost(t);
      const quote = li.querySelector<HTMLButtonElement>('.thread-quote')!;
      quote.textContent = `“${short(t.anchor.quote)}”`;
      quote.title = lost ? t.anchor.quote : 'Select this text in the editor';
      quote.disabled = lost;
      quote.addEventListener('click', () => {
        comments.focus(t.id);
        requestReveal(t.anchor);
      });
      li.querySelector<HTMLElement>('.thread-lost')!.hidden = !lost;
      const messages = li.querySelector('.comment-messages')!;
      for (const m of t.messages) {
        const item = messageTpl.content.firstElementChild!.cloneNode(
          true
        ) as HTMLElement;
        item.classList.add(m.author);
        item.querySelector('.message-author')!.textContent =
          m.author === 'you' ? 'You' : 'Assistant';
        item.querySelector('.message-text')!.textContent = m.text;
        messages.append(item);
      }
      const reply = li.querySelector<HTMLFormElement>('.thread-reply')!;
      const input = li.querySelector<HTMLTextAreaElement>('.reply-input')!;
      input.setAttribute('aria-label', 'Reply');
      const send = () => {
        if (!input.value.trim()) return;
        void comments.reply(t.id, 'you', input.value);
      };
      reply.addEventListener('submit', (e) => {
        e.preventDefault();
        send();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          send();
        }
      });
      const resolve = li.querySelector<HTMLButtonElement>('.thread-resolve')!;
      const open = t.status === 'open';
      resolve.textContent = open ? 'Resolve' : 'Reopen';
      resolve.addEventListener(
        'click',
        () => void comments.resolve(t.id, open, 'you')
      );
      return li;
    };

    let shownDraft: CommentsState['draft'] = null;
    const render = (s: CommentsState) => {
      draft.hidden = !s.draft;
      if (s.draft && s.draft !== shownDraft) {
        draftQuote.textContent = `“${short(s.draft.quote)}”`;
        draftInput.value = '';
        draftInput.focus();
      }
      shownDraft = s.draft;
      empty.hidden = s.threads.length > 0 || !!s.draft;
      // Keep a reply being typed: rebuild, then put its text back.
      const typing = new Map(
        [...list.querySelectorAll<HTMLElement>('.comment-thread')].map((li) => [
          li.dataset.thread!,
          li.querySelector<HTMLTextAreaElement>('.reply-input')!,
        ])
      );
      const active = document.activeElement;
      list.replaceChildren(
        ...s.threads.map((t) => {
          const li = renderThread(t, t.id === s.focus);
          const old = typing.get(t.id);
          const input = li.querySelector<HTMLTextAreaElement>('.reply-input')!;
          // A reply just sent clears; one still being written stays.
          const sent =
            old && t.messages.at(-1)?.text === old.value.trim() && old.value;
          if (old && !sent) input.value = old.value;
          if (old && old === active && !sent)
            queueMicrotask(() => input.focus());
          return li;
        })
      );
    };
    render(comments.store.getState());
    comments.store.addEventListener('change', ((
      e: CustomEvent<CommentsState>
    ) => render(e.detail)) as EventListener);
  }
}

if (!customElements.get(CommentsPanelComponent.tagName)) {
  customElements.define(CommentsPanelComponent.tagName, CommentsPanelComponent);
}
