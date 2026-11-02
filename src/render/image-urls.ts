import type { ImageInfo } from '../images/header.ts';

interface ImageState {
  images: { name: string; sha256: string }[];
  files: Record<string, { blob: Blob; info: ImageInfo }>;
}

/**
 * blob: URLs for the open document's images, one per distinct file (by
 * SHA-256), kept across re-renders and revoked once no name uses them.
 */
export class ImageUrls {
  private urls = new Map<string, string>();
  private create: (blob: Blob) => string;
  private revoke: (url: string) => void;

  constructor(
    create: (blob: Blob) => string = (b) => URL.createObjectURL(b),
    revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)
  ) {
    this.create = create;
    this.revoke = revoke;
  }

  /** The renderer's `images` option for this state. */
  update(state: ImageState): Record<string, { url: string; info: ImageInfo }> {
    const out: Record<string, { url: string; info: ImageInfo }> = {};
    const used = new Set<string>();
    for (const { name, sha256 } of state.images) {
      const file = state.files[name];
      if (!file) continue;
      let url = this.urls.get(sha256);
      if (!url) this.urls.set(sha256, (url = this.create(file.blob)));
      used.add(sha256);
      out[name] = { url, info: file.info };
    }
    for (const [sha, url] of this.urls)
      if (!used.has(sha)) {
        this.revoke(url);
        this.urls.delete(sha);
      }
    return out;
  }

  clear(): void {
    this.update({ images: [], files: {} });
  }
}
