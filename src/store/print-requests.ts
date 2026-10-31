import type { PreprintStamp } from '../workspace/workspace.ts';

/** What to print. Empty: the current document, as is. */
export interface PrintJob {
  /** Print this source instead of the current one (e.g. a saved version). */
  source?: string;
  /** PDF file name (Chromium uses the document title). */
  title?: string;
  /** Preprint footer stamp. */
  stamp?: PreprintStamp;
}

/**
 * App-wide "print the document" requests. The toolbar and the keyboard
 * shortcut ask; <latex-preview> owns the iframe and does the printing.
 */
export const printRequests = new EventTarget();

export function requestPrint(job: PrintJob = {}): void {
  printRequests.dispatchEvent(
    new CustomEvent<PrintJob>('print', { detail: job })
  );
}
