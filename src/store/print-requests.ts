/**
 * App-wide "print the document" requests. The toolbar and the keyboard
 * shortcut ask; <latex-preview> owns the iframe and does the printing.
 */
export const printRequests = new EventTarget();

export function requestPrint(): void {
  printRequests.dispatchEvent(new Event('print'));
}
