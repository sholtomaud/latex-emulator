import type {
  DocumentRepository,
  ImageBlob,
  ImageEntry,
} from '../storage/types.ts';
import { imageInfo, naturalSizeBp } from '../images/header.ts';
import type { ImageInfo } from '../images/header.ts';

/**
 * Images for \includegraphics (ADR 0013): each document has its own folder
 * of names, and the bytes are stored once by SHA-256, so an image can be
 * reused in another document without a copy. Pure logic over a repository.
 */

export interface ImageMeta {
  name: string;
  sha256: string;
  type: ImageInfo['type'];
  info: ImageInfo;
  /** File size in bytes. */
  bytes: number;
  /** pdfTeX's natural size in bp, when known. */
  naturalBp: { width: number; height: number } | null;
  updatedAt: number;
}

export interface ImageLibraryState {
  documentId: string | null;
  /** The open document's images, sorted by name. */
  images: ImageMeta[];
  /** Images in other documents that this one could reuse. */
  elsewhere: Pick<ImageEntry, 'id' | 'documentId' | 'name' | 'sha256'>[];
  /** The open document's files by name, for the preview. */
  files: Record<string, { blob: Blob; info: ImageInfo }>;
}

export interface ImageLibraryOptions {
  now: () => number;
  publish: (state: ImageLibraryState) => void;
}

export type ImageResult =
  { ok: true; name: string; existing?: true } | { ok: false; message: string };

type ImageRepository = Pick<
  DocumentRepository,
  'listImages' | 'getImageBlob' | 'putImage' | 'deleteImage' | 'deleteImages'
>;

/** Larger files are refused: they would bloat IndexedDB and the preview. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const EXTENSIONS: Record<ImageInfo['type'], string[]> = {
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg'],
  pdf: ['.pdf'],
};
const IMAGE_EXT = /\.(png|jpe?g|pdf|gif|webp|bmp|tiff?|heic|avif|svg|eps|ps)$/i;

/** A name with the extension pdfTeX expects for this type of file. */
function withExtension(base: string, type: ImageInfo['type']): string {
  const ext = /\.[^./]+$/.exec(base)?.[0].toLowerCase();
  if (ext && EXTENSIONS[type].includes(ext))
    return base.slice(0, -ext.length) + ext;
  return base.replace(IMAGE_EXT, '') + EXTENSIONS[type][0];
}

/**
 * The name to store an imported file under: its base name with awkward
 * characters made safe, and an extension that matches what the file is
 * (pdfTeX chooses the image reader by extension).
 */
export function imageName(
  fileName: string | null,
  type: ImageInfo['type']
): string {
  if (fileName === null) return withExtension('pasted-image', type);
  const raw = fileName.split(/[\\/]/).pop() ?? '';
  const ext = IMAGE_EXT.exec(raw)?.[0] ?? '';
  const stem = raw
    .slice(0, raw.length - ext.length)
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return withExtension((stem || 'image') + ext, type);
}

/** `name`, or name-2, name-3… before the extension when it is taken. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++)
    if (!taken.has(`${stem}-${n}${ext}`)) return `${stem}-${n}${ext}`;
}

/** Folders allowed, but only plain segments: no spaces, `..` or absolute paths. */
const SAFE_PATH =
  /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

export class ImageLibrary {
  private entries = new Map<string, ImageEntry>();
  private blobs = new Map<string, ImageBlob>();
  private documentId: string | null = null;
  private repo: ImageRepository;
  private options: ImageLibraryOptions;

  constructor(repo: ImageRepository, options: ImageLibraryOptions) {
    this.repo = repo;
    this.options = options;
  }

  async init(): Promise<void> {
    for (const e of await this.repo.listImages()) this.entries.set(e.id, e);
  }

  /** Show `documentId`'s images (loading their bytes). */
  async open(documentId: string): Promise<void> {
    this.documentId = documentId;
    for (const e of this.mine()) await this.load(e.sha256);
    this.publish();
  }

  /** Import a file into the open document's folder. */
  async add(
    fileName: string | null,
    bytes: Uint8Array<ArrayBuffer>
  ): Promise<ImageResult> {
    const documentId = this.documentId;
    if (documentId === null)
      return { ok: false, message: 'Open a document first.' };
    const label = fileName ?? 'The pasted image';
    if (bytes.length > MAX_IMAGE_BYTES)
      return { ok: false, message: `${label} is larger than 25 MB.` };
    const info = imageInfo(bytes);
    if (!info)
      return {
        ok: false,
        message: `${label} isn’t an image pdflatex can include: use PNG, JPEG or PDF.`,
      };
    const sha256 = await sha256Bytes(bytes);
    const same = this.mine().find((e) => e.sha256 === sha256);
    if (same) return { ok: true, name: same.name, existing: true };
    const name = uniqueName(imageName(fileName, info.type), this.names());
    const known =
      this.blobs.get(sha256) ?? (await this.repo.getImageBlob(sha256));
    const blob: ImageBlob = known ?? {
      sha256,
      blob: new Blob([bytes], { type: MIME[info.type] }),
      info,
    };
    await this.put({ documentId, name, sha256 }, known ? undefined : blob);
    return { ok: true, name };
  }

  /** Add another document's image to this one's folder, sharing its bytes. */
  async reuse(entryId: string): Promise<ImageResult> {
    const source = this.entries.get(entryId);
    if (!source || this.documentId === null)
      return { ok: false, message: 'That image is gone.' };
    const name = uniqueName(source.name, this.names());
    await this.put({
      documentId: this.documentId,
      name,
      sha256: source.sha256,
    });
    return { ok: true, name };
  }

  async rename(name: string, newName: string): Promise<ImageResult> {
    const entry = this.entry(name);
    if (!entry) return { ok: false, message: `${name} is gone.` };
    const type = (await this.load(entry.sha256))?.info.type;
    const target = type ? withExtension(newName.trim(), type) : newName.trim();
    if (target === name) return { ok: true, name };
    if (!SAFE_PATH.test(target))
      return {
        ok: false,
        message:
          'Use letters, digits, - _ . and / for folders: no spaces or “..”.',
      };
    if (this.names().has(target))
      return { ok: false, message: `${target} already exists.` };
    this.entries.delete(entry.id);
    await this.repo.deleteImage(entry.id);
    await this.put({
      documentId: entry.documentId,
      name: target,
      sha256: entry.sha256,
    });
    return { ok: true, name: target };
  }

  async delete(name: string): Promise<void> {
    const entry = this.entry(name);
    if (!entry) return;
    this.entries.delete(entry.id);
    await this.repo.deleteImage(entry.id);
    this.publish();
  }

  /** A deleted document takes its folder with it. */
  async deleteDocument(documentId: string): Promise<void> {
    for (const e of this.entries.values())
      if (e.documentId === documentId) this.entries.delete(e.id);
    await this.repo.deleteImages(documentId);
    this.publish();
  }

  /** The open document's image as a download. */
  file(name: string): { fileName: string; blob: Blob } | null {
    const entry = this.entry(name);
    const blob = entry && this.blobs.get(entry.sha256);
    return blob ? { fileName: name.split('/').pop()!, blob: blob.blob } : null;
  }

  private mine(): ImageEntry[] {
    return [...this.entries.values()].filter(
      (e) => e.documentId === this.documentId
    );
  }

  private names(): Set<string> {
    return new Set(this.mine().map((e) => e.name));
  }

  private entry(name: string): ImageEntry | undefined {
    return this.documentId === null
      ? undefined
      : this.entries.get(`${this.documentId}/${name}`);
  }

  private async load(sha256: string): Promise<ImageBlob | undefined> {
    const cached = this.blobs.get(sha256);
    if (cached) return cached;
    const blob = await this.repo.getImageBlob(sha256);
    if (blob) this.blobs.set(sha256, blob);
    return blob;
  }

  private async put(
    e: Pick<ImageEntry, 'documentId' | 'name' | 'sha256'>,
    blob?: ImageBlob
  ) {
    const entry: ImageEntry = {
      id: `${e.documentId}/${e.name}`,
      ...e,
      updatedAt: this.options.now(),
    };
    if (blob) this.blobs.set(blob.sha256, blob);
    this.entries.set(entry.id, entry);
    await this.repo.putImage(entry, blob);
    await this.load(entry.sha256);
    this.publish();
  }

  private publish() {
    const mine = this.mine().sort((a, b) => a.name.localeCompare(b.name));
    const shas = new Set(mine.map((e) => e.sha256));
    const images: ImageMeta[] = [];
    const files: ImageLibraryState['files'] = {};
    for (const e of mine) {
      const b = this.blobs.get(e.sha256);
      if (!b) continue;
      files[e.name] = { blob: b.blob, info: b.info };
      images.push({
        name: e.name,
        sha256: e.sha256,
        type: b.info.type,
        info: b.info,
        bytes: b.blob.size,
        naturalBp: naturalSizeBp(b.info),
        updatedAt: e.updatedAt,
      });
    }
    this.options.publish({
      documentId: this.documentId,
      images,
      elsewhere: [...this.entries.values()]
        .filter((e) => e.documentId !== this.documentId && !shas.has(e.sha256))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, documentId, name, sha256 }) => ({
          id,
          documentId,
          name,
          sha256,
        })),
      files,
    });
  }
}

const MIME: Record<ImageInfo['type'], string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
};
