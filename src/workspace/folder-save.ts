import type { Project } from './project.ts';
import type { ZipFile } from '../util/zip.ts';
import { bibliographyFiles } from '../render/bibliography.ts';
import { graphicReferences } from '../images/references.ts';
import { resolveGraphic } from '../images/resolve.ts';
import { nameFromFileName } from './names.ts';

/**
 * Saving a document's project folder into a folder on this computer, and
 * opening one (ADR 0015 phase B). The folder is reached through a small
 * interface (fs-access.ts adapts the File System Access API to it), so this
 * logic is pure and tested with an in-memory folder.
 *
 * A file that changed in the folder since we last saved it (in another
 * editor, or synced from another machine) is never overwritten silently:
 * the save reports it as a conflict and writes nothing until told to.
 */

export interface ProjectDirectory {
  /** The folder's own name. */
  readonly name: string;
  /** A file's bytes by relative path (`/` between folders), null if absent. */
  read(path: string): Promise<Uint8Array | null>;
  /** Creates the file, and its folders, or replaces it. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Every file below, as relative paths. */
  list(): Promise<string[]>;
}

/** SHA-256 by path, of what we last wrote to (or read from) the folder. */
export type SavedHashes = Record<string, string>;

export interface FolderSavePlan {
  write: string[];
  /** Already identical in the folder. */
  same: string[];
  /** Changed in the folder since our last save: not ours to overwrite. */
  conflicts: string[];
}

export type SaveResult =
  | { ok: true; written: string[]; saved: SavedHashes }
  | { ok: false; conflicts: string[] };

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * The project's files relative to its folder (buildProject prefixes it).
 * `texPath` keeps the .tex at the name the folder already uses, so renaming
 * the document doesn't leave a second .tex there.
 */
export function projectFiles(project: Project, texPath?: string): ZipFile[] {
  const prefix = `${project.folder}/`;
  return project.files.map((f, i) => ({
    path:
      i === 0 && texPath
        ? texPath
        : f.path.startsWith(prefix)
          ? f.path.slice(prefix.length)
          : f.path,
    bytes: f.bytes,
  }));
}

/**
 * `target`: hashes we want in the folder. `onDisk`: what is there now (null
 * when the file is absent). `last`: what we left there at the last save.
 */
export function planFolderSave(
  target: Record<string, string>,
  onDisk: Record<string, string | null>,
  last: SavedHashes
): FolderSavePlan {
  const plan: FolderSavePlan = { write: [], same: [], conflicts: [] };
  for (const [path, hash] of Object.entries(target)) {
    const there = onDisk[path] ?? null;
    if (there === hash) plan.same.push(path);
    else if (there === null || there === last[path]) plan.write.push(path);
    else plan.conflicts.push(path);
  }
  return plan;
}

export async function saveProject(
  dir: ProjectDirectory,
  files: ZipFile[],
  last: SavedHashes,
  options: { overwrite?: boolean } = {}
): Promise<SaveResult> {
  const target: Record<string, string> = {};
  const onDisk: Record<string, string | null> = {};
  for (const f of files) {
    target[f.path] = await sha256Bytes(f.bytes);
    const there = await dir.read(f.path);
    onDisk[f.path] = there ? await sha256Bytes(there) : null;
  }
  const plan = planFolderSave(target, onDisk, last);
  if (plan.conflicts.length && !options.overwrite)
    return { ok: false, conflicts: plan.conflicts };
  const toWrite = new Set([...plan.write, ...plan.conflicts]);
  const written: string[] = [];
  for (const f of files)
    if (toWrite.has(f.path)) {
      await dir.write(f.path, f.bytes);
      written.push(f.path);
    }
  return { ok: true, written, saved: { ...last, ...target } };
}

export interface OpenedProject {
  /** A document name from the .tex file's name. */
  name: string;
  texPath: string;
  source: string;
  /** The .bib files the document's \bibliography lists that the folder has. */
  bibFiles: { name: string; source: string }[];
  /** The images its \includegraphics use, at the names graphicx resolves. */
  images: { name: string; bytes: Uint8Array }[];
  /** Listed .bib files and \includegraphics names the folder lacks. */
  missing: string[];
  /** Hashes of what was read: the baseline for saving back. */
  saved: SavedHashes;
}

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** The project in a folder: its main .tex and the files that .tex uses. */
export async function readProject(
  dir: ProjectDirectory
): Promise<
  { ok: true; project: OpenedProject } | { ok: false; message: string }
> {
  const all = (await dir.list()).sort();
  const texPaths = all.filter((p) => !p.includes('/') && /\.tex$/i.test(p));
  if (!texPaths.length)
    return {
      ok: false,
      message: 'That folder has no .tex file at its top level.',
    };
  const sources = new Map<string, string>();
  for (const p of texPaths) sources.set(p, decode((await dir.read(p))!));
  const texPath =
    texPaths.find((p) => p.replace(/\.tex$/i, '') === dir.name) ??
    texPaths.find((p) => sources.get(p)!.includes('\\begin{document}')) ??
    texPaths[0];
  const source = sources.get(texPath)!;
  const saved: SavedHashes = {
    [texPath]: await sha256Bytes(new TextEncoder().encode(source)),
  };
  const missing: string[] = [];

  const bibFiles: OpenedProject['bibFiles'] = [];
  for (const name of new Set(bibliographyFiles(source))) {
    const bytes = await dir.read(`${name}.bib`);
    if (!bytes) {
      missing.push(`${name}.bib`);
      continue;
    }
    bibFiles.push({ name, source: decode(bytes) });
    saved[`${name}.bib`] = await sha256Bytes(bytes);
  }

  const images: OpenedProject['images'] = [];
  const refs = graphicReferences(source);
  for (const arg of refs.names) {
    const name = resolveGraphic(arg, all, refs.graphicsPath);
    const bytes = name === null ? null : await dir.read(name);
    if (name === null || !bytes) {
      missing.push(arg);
      continue;
    }
    if (images.some((i) => i.name === name)) continue;
    images.push({ name, bytes });
    saved[name] = await sha256Bytes(bytes);
  }
  return {
    ok: true,
    project: {
      name: nameFromFileName(texPath),
      texPath,
      source,
      bibFiles,
      images,
      missing,
      saved,
    },
  };
}
