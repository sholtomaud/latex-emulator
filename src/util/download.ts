/** Offer `blob` to the user as a file download. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Offer `text` to the user as a file download. */
export function downloadText(
  fileName: string,
  text: string,
  type: string
): void {
  downloadBlob(fileName, new Blob([text], { type }));
}
