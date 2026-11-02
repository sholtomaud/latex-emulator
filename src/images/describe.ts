import type { ImageInfo } from './header.ts';

const size = (bytes: number) =>
  bytes < 1000
    ? `${bytes} B`
    : bytes < 1_000_000
      ? `${(bytes / 1000).toFixed(1)} KB`
      : `${(bytes / 1_000_000).toFixed(1)} MB`;

/** "PNG · 600 × 300 px · 300 dpi · 1.6 KB", for the explorer. */
export function describeImage(info: ImageInfo, bytes: number): string {
  const parts: string[] = [info.type.toUpperCase()];
  if (info.type === 'pdf') {
    if (info.widthBp !== undefined && info.heightBp !== undefined)
      parts.push(
        `${Math.round(info.widthBp)} × ${Math.round(info.heightBp)} pt`
      );
  } else {
    parts.push(`${info.widthPx} × ${info.heightPx} px`);
    if (info.dpiX !== undefined) parts.push(`${info.dpiX} dpi`);
  }
  parts.push(size(bytes));
  return parts.join(' · ');
}

/** What "Copy \includegraphics" puts on the clipboard. */
export function includeSnippet(name: string): string {
  return `\\includegraphics[width=\\linewidth]{${name}}`;
}
