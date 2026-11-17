/**
 * The reviewing agent in the browser (ADR 0025 §3): one queue following
 * the open document and the assistant's "Review as I write" switch, using
 * the chat's provider and model, with tools scoped to the paragraph under
 * review, and the reviewed keys in IndexedDB (memory when unavailable).
 */
import {
  ReviewController,
  MemoryReviewed,
} from './review/review-controller.ts';
import type { ReviewedStore } from './review/review-controller.ts';
import { reviewParagraph } from './review/review-run.ts';
import { findParagraph } from './review/paragraphs.ts';
import { AssistantTools } from './assistant-tools.ts';
import { assistant, toolDeps } from './assistant-service.ts';
import type { AssistantState } from './assistant-controller.ts';
import { comments } from '../comments/comments-service.ts';
import { documentStore } from '../store/document-store.ts';
import type { DocumentState } from '../store/document-store.ts';
import { workspaceStore } from '../store/workspace-store.ts';
import type { WorkspaceStoreState } from '../store/workspace-store.ts';

const reviewed: ReviewedStore = (() => {
  let ready: Promise<ReviewedStore> | null = null;
  const open = () =>
    (ready ??= import('../storage/reviewed-db.ts')
      .then((m) => m.IndexedDbReviewed.open() as Promise<ReviewedStore>)
      .catch(() => new MemoryReviewed()));
  return {
    get: async (id) => (await open()).get(id),
    put: async (id, keys) => (await open()).put(id, keys),
    delete: async (id) => (await open()).delete(id),
  };
})();

export const review = new ReviewController({
  reviewed,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  review: (job, signal) =>
    reviewParagraph(
      {
        fetch: (url, init) => fetch(url, init),
        config: () =>
          assistant.config(assistant.store.getState().settings.provider),
        problem: () => assistant.reviewProblem(),
        name: () => assistant.store.getState().documentName,
        threads: () => comments.store.getState().threads,
        tools: (j) => {
          const p = j.paragraphs[j.index];
          return new AssistantTools({
            ...toolDeps,
            // Where the paragraph is now: the author may type elsewhere.
            scope: () =>
              findParagraph(documentStore.getState().source, p.text, p.start),
          });
        },
      },
      job,
      signal
    ),
});

/** Follow the assistant's document and switch. */
function follow(s: AssistantState) {
  if (!s.documentId) return;
  if (s.documentId !== review.store.getState().documentId)
    void review.openDocument(
      s.documentId,
      workspaceStore.getState().activeSource,
      s.reviewing
    );
  else review.setOn(s.reviewing);
}
follow(assistant.store.getState());
assistant.store.addEventListener('change', ((e: CustomEvent<AssistantState>) =>
  follow(e.detail)) as EventListener);

let lastSource = documentStore.getState().source;
documentStore.addEventListener('change', ((e: CustomEvent<DocumentState>) => {
  if (e.detail.source === lastSource) return;
  lastSource = e.detail.source;
  review.changed(lastSource);
}) as EventListener);

/** Forget a deleted document's reviewed paragraphs. */
let known = new Set<string>();
function forget({ documents }: WorkspaceStoreState) {
  const ids = new Set(documents.map((d) => d.id));
  for (const id of known) if (!ids.has(id)) void reviewed.delete(id);
  known = ids;
}
forget(workspaceStore.getState());
workspaceStore.addEventListener('change', ((
  e: CustomEvent<WorkspaceStoreState>
) => forget(e.detail)) as EventListener);
