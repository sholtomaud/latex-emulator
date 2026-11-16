import { Store } from '../core/store.ts';
import type { Excerpt } from '../assistant/context.ts';

/**
 * What other parts of the app need from the editor without reaching into
 * it (AGENTS.md §3): the current selection, and requests to insert text.
 * <latex-editor> publishes the one and handles the other.
 */
export interface EditorBridgeState {
  /** The selected lines, or null when nothing is selected. */
  selection: Excerpt | null;
}

export const editorBridge = new Store<EditorBridgeState>({ selection: null });

/** Requests for <latex-editor>: 'insert' (CustomEvent<string>). */
export const editorRequests = new EventTarget();

/** Insert text at the cursor, replacing the selection if there is one. */
export function requestInsert(text: string): void {
  editorRequests.dispatchEvent(
    new CustomEvent<string>('insert', { detail: text })
  );
}
