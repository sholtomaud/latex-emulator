import type {
  BibFile,
  ImageBlob,
  ImageEntry,
  StoredDocument,
  VersionRecord,
} from '../storage/types.ts';
import type { ZipFile } from '../util/zip.ts';
import { imageInfo } from '../images/header.ts';
import type { ImageInfo } from '../images/header.ts';
import { fileNameFor, uniqueName } from './names.ts';
import { sha256Hex } from './versions.ts';

/**
 * A backup of the whole workspace as one zip (ADR 0019): every document,
 * version, .bib file and image, so a browser that loses its storage costs
 * a restore, not the work. `workspace.json` holds the records and
 * `blobs/<sha256>` the image bytes; readable copies of the .tex and .bib
 * files sit alongside for anyone opening the zip without the app (restore
 * ignores them). Restoring merges: the newer copy of each item wins, so a
 * restore never overwrites newer work. A backup file is untrusted input:
 * every record is checked before anything is stored. Pure.
 */

export const BACKUP_FORMAT = 'latex-emulator-backup';
const BACKUP_VERSION = 1;

export interface WorkspaceSnapshot {
  documents: StoredDocument[];
  versions: VersionRecord[];
  bibFiles: BibFile[];
  images: ImageEntry[];
  blobs: { sha256: string; bytes: Uint8Array }[];
}

export interface Backup extends Omit<WorkspaceSnapshot, 'blobs'> {
  createdAt: number;
  blobs: ImageBlob[];
}

/** What the browser holds now, as much as a restore needs to know. */
export interface CurrentWorkspace {
  documents: StoredDocument[];
  versionIds: ReadonlySet<string>;
  bibFiles: BibFile[];
  images: ImageEntry[];
  blobShas: ReadonlySet<string>;
  /**
   * Starter items nobody has edited (the sample document and references.bib
   * a fresh browser creates). They give way to the backup's copies.
   */
  untouched?: {
    documents: ReadonlySet<string>;
    bibFiles: ReadonlySet<string>;
  };
}

export interface RestorePlan {
  /** Untouched starter documents the backup replaces. */
  remove: string[];
  documents: StoredDocument[];
  versions: VersionRecord[];
  bibFiles: BibFile[];
  /** With the bytes when the browser doesn't have them yet. */
  images: { entry: ImageEntry; blob?: ImageBlob }[];
  /** Items left alone because this browser's copy is the same or newer. */
  unchanged: number;
}

const encode = (s: string) => new TextEncoder().encode(s);

/** "latex-emulator-backup-2026-11-05.zip", in local time. */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `latex-emulator-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

export function backupFiles(
  s: WorkspaceSnapshot,
  createdAt: number
): ZipFile[] {
  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    documents: s.documents,
    versions: s.versions,
    bibFiles: s.bibFiles,
    images: s.images,
    blobs: s.blobs.map((b) => b.sha256),
  };
  const files: ZipFile[] = [
    {
      path: 'workspace.json',
      bytes: encode(JSON.stringify(manifest, null, 1)),
    },
    ...s.blobs.map((b) => ({ path: `blobs/${b.sha256}`, bytes: b.bytes })),
  ];
  const taken = new Set<string>();
  for (const d of s.documents) {
    const stem = fileNameFor(d.name, '');
    let name = stem;
    for (let n = 2; taken.has(name); n++) name = `${stem}-${n}`;
    taken.add(name);
    files.push({ path: `documents/${name}.tex`, bytes: encode(d.source) });
  }
  for (const b of s.bibFiles)
    if (SAFE_NAME.test(b.name))
      files.push({
        path: `bibliography/${b.name}.bib`,
        bytes: encode(b.source),
      });
  return files;
}

/** Plain relative names: no empty, `.` or `..` segments, no backslashes. */
const SAFE_NAME = /^(?!.*(^|\/)\.{1,2}(\/|$))[^\\/][^\\]*$/;
const SHA = /^[0-9a-f]{64}$/;

type Result = { ok: true; backup: Backup } | { ok: false; message: string };

class Damaged extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function list(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v) || !v.every(isObject)) throw new Damaged();
  return v;
}

function str(o: Record<string, unknown>, k: string): string {
  if (typeof o[k] !== 'string') throw new Damaged();
  return o[k];
}

function num(o: Record<string, unknown>, k: string): number {
  if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) throw new Damaged();
  return o[k];
}

function sha(o: Record<string, unknown>, k: string): string {
  const v = str(o, k);
  if (!SHA.test(v)) throw new Damaged();
  return v;
}

function safe(o: Record<string, unknown>, k: string): string {
  const v = str(o, k);
  if (!SAFE_NAME.test(v)) throw new Damaged();
  return v;
}

const MIME: Record<ImageInfo['type'], string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
};

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

/** The backup in an unzipped archive, checked record by record. */
export async function readBackup(files: ZipFile[]): Promise<Result> {
  const file = files.find((f) => f.path === 'workspace.json');
  if (!file)
    return {
      ok: false,
      message:
        'That zip is not a LaTeX Emulator backup: it has no workspace.json.',
    };
  const damaged = {
    ok: false as const,
    message: 'That backup is damaged: its workspace.json can’t be read.',
  };
  let m: unknown;
  try {
    m = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
    );
  } catch {
    return damaged;
  }
  if (!isObject(m) || m.format !== BACKUP_FORMAT)
    return { ok: false, message: 'That zip is not a LaTeX Emulator backup.' };
  if (m.version !== BACKUP_VERSION)
    return {
      ok: false,
      message:
        'That backup was made by a newer version of LaTeX Emulator. Reload the app to update it, then restore again.',
    };
  try {
    const documents: StoredDocument[] = list(m.documents).map((d) => ({
      id: str(d, 'id'),
      name: str(d, 'name'),
      source: str(d, 'source'),
      createdAt: num(d, 'createdAt'),
      updatedAt: num(d, 'updatedAt'),
    }));
    const versions: VersionRecord[] = list(m.versions).map((v) => ({
      id: str(v, 'id'),
      documentId: str(v, 'documentId'),
      version: str(v, 'version'),
      createdAt: num(v, 'createdAt'),
      sha256: sha(v, 'sha256'),
      source: str(v, 'source'),
    }));
    const bibFiles: BibFile[] = list(m.bibFiles).map((b) => ({
      name: safe(b, 'name'),
      source: str(b, 'source'),
      updatedAt: num(b, 'updatedAt'),
    }));
    let images: ImageEntry[] = list(m.images).map((i) => {
      const entry = {
        id: str(i, 'id'),
        documentId: str(i, 'documentId'),
        name: safe(i, 'name'),
        sha256: sha(i, 'sha256'),
        updatedAt: num(i, 'updatedAt'),
      };
      if (entry.id !== `${entry.documentId}/${entry.name}`) throw new Damaged();
      return entry;
    });
    const createdAt = num(m, 'createdAt');

    // A version's hash is what its preprint stamp prints: it must be right.
    for (const v of versions)
      if ((await sha256Hex(v.source)) !== v.sha256)
        return {
          ok: false,
          message: `That backup is damaged: version ${v.version} doesn’t match its checksum.`,
        };
    const blobs: ImageBlob[] = [];
    if (!Array.isArray(m.blobs)) throw new Damaged();
    for (const hash of m.blobs) {
      if (typeof hash !== 'string' || !SHA.test(hash)) throw new Damaged();
      const bytes = files.find((f) => f.path === `blobs/${hash}`)?.bytes;
      if (!bytes) continue;
      if ((await sha256Bytes(bytes)) !== hash)
        return {
          ok: false,
          message:
            'That backup is damaged: an image doesn’t match its checksum.',
        };
      // Recomputed, not trusted: only what pdflatex could include is kept.
      const info = imageInfo(bytes);
      if (!info) continue;
      blobs.push({
        sha256: hash,
        info,
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], {
          type: MIME[info.type],
        }),
      });
    }
    const kept = new Set(blobs.map((b) => b.sha256));
    images = images.filter((i) => kept.has(i.sha256));
    return {
      ok: true,
      backup: { createdAt, documents, versions, bibFiles, images, blobs },
    };
  } catch (e) {
    if (e instanceof Damaged)
      return {
        ok: false,
        message: 'That backup is damaged: some of its records are malformed.',
      };
    throw e;
  }
}

/** What to write so the browser holds the newer copy of everything. */
export function planRestore(current: CurrentWorkspace, b: Backup): RestorePlan {
  let unchanged = 0;
  const newer = <T extends { updatedAt: number }>(
    mine: T | undefined,
    theirs: T
  ) => {
    if (!mine || theirs.updatedAt > mine.updatedAt) return true;
    unchanged++;
    return false;
  };
  const untouchedDocs = current.untouched?.documents ?? new Set<string>();
  const untouchedBibs = current.untouched?.bibFiles ?? new Set<string>();
  const docs = new Map(current.documents.map((d) => [d.id, d]));
  const documents = b.documents.filter((d) => newer(docs.get(d.id), d));
  // Names stay unique: a starter with a restored document's name goes, and
  // a restored document clashing with an edited one is renamed.
  const incoming = new Set(documents.map((d) => d.name.trim().toLowerCase()));
  const remove = current.documents
    .filter(
      (d) =>
        untouchedDocs.has(d.id) &&
        !documents.some((r) => r.id === d.id) &&
        incoming.has(d.name.trim().toLowerCase())
    )
    .map((d) => d.id);
  const names = current.documents
    .filter(
      (d) => !remove.includes(d.id) && !documents.some((r) => r.id === d.id)
    )
    .map((d) => d.name);
  for (const [i, d] of documents.entries()) {
    const name = docs.has(d.id) ? d.name : uniqueName(d.name, names);
    if (name !== d.name) documents[i] = { ...d, name };
    names.push(name);
  }
  const known = new Set(
    [...docs.keys(), ...documents.map((d) => d.id)].filter(
      (id) => !remove.includes(id)
    )
  );

  const versions = b.versions.filter((v) => {
    if (!known.has(v.documentId)) return false;
    if (current.versionIds.has(v.id)) {
      unchanged++;
      return false;
    }
    return true;
  });
  const bibs = new Map(current.bibFiles.map((f) => [f.name, f]));
  const bibFiles = b.bibFiles.filter((f) => {
    const mine = bibs.get(f.name);
    if (mine && untouchedBibs.has(f.name) && mine.source !== f.source)
      return true;
    return newer(mine, f);
  });

  const entries = new Map(current.images.map((e) => [e.id, e]));
  const blobs = new Map(b.blobs.map((x) => [x.sha256, x]));
  const images: RestorePlan['images'] = [];
  for (const entry of b.images) {
    if (!known.has(entry.documentId) || !newer(entries.get(entry.id), entry))
      continue;
    images.push(
      current.blobShas.has(entry.sha256)
        ? { entry }
        : { entry, blob: blobs.get(entry.sha256) }
    );
  }
  return { remove, documents, versions, bibFiles, images, unchanged };
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function restoreSummary(plan: RestorePlan): string {
  const parts = [
    plan.documents.length && count(plan.documents.length, 'document'),
    plan.versions.length && count(plan.versions.length, 'version'),
    plan.bibFiles.length && count(plan.bibFiles.length, '.bib file'),
    plan.images.length && count(plan.images.length, 'image'),
  ].filter((p): p is string => Boolean(p));
  if (!parts.length)
    return `Nothing to restore: everything in the backup is already here (${count(plan.unchanged, 'item')}).`;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  const kept = plan.unchanged
    ? ` ${count(plan.unchanged, 'item')} here ${plan.unchanged === 1 ? 'was' : 'were'} the same or newer, so ${plan.unchanged === 1 ? 'it was' : 'they were'} kept.`
    : '';
  return `Restored ${list}.${kept}`;
}
