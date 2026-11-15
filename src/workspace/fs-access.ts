import type { ProjectDirectory } from './folder-save.ts';

/**
 * The File System Access API (Chromium) behind ProjectDirectory (ADR 0015
 * phase B). Typed structurally, with only the members we use, so tests can
 * pass fakes and so it compiles whatever the DOM typings include.
 */

export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<Blob>;
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface DirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<DirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileHandle>;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

/** Relative paths only: no empty, `.` or `..` segments, no backslashes. */
function segments(path: string): string[] | null {
  const parts = path.split('/');
  return !path.includes('\\') &&
    parts.every((p) => p !== '' && p !== '.' && p !== '..')
    ? parts
    : null;
}

const missing = (e: unknown) =>
  e instanceof DOMException &&
  (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

export function directoryOf(
  root: DirectoryHandle,
  limits: { maxDepth?: number; maxFiles?: number } = {}
): ProjectDirectory {
  const maxDepth = limits.maxDepth ?? 4;
  const maxFiles = limits.maxFiles ?? 2000;
  return {
    name: root.name,
    async read(path) {
      const parts = segments(path);
      if (!parts) return null;
      try {
        let dir = root;
        for (const p of parts.slice(0, -1))
          dir = await dir.getDirectoryHandle(p);
        const file = await dir.getFileHandle(parts.at(-1)!);
        return new Uint8Array(await (await file.getFile()).arrayBuffer());
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    async write(path, bytes) {
      const parts = segments(path);
      if (!parts) throw new Error(`Not a safe path in a folder: “${path}”`);
      let dir = root;
      for (const p of parts.slice(0, -1))
        dir = await dir.getDirectoryHandle(p, { create: true });
      const file = await dir.getFileHandle(parts.at(-1)!, { create: true });
      const out = await file.createWritable();
      await out.write(bytes);
      await out.close();
    },
    /** Files below, skipping hidden folders, bounded so a huge folder can't stall us. */
    async list() {
      const paths: string[] = [];
      const walk = async (
        dir: DirectoryHandle,
        prefix: string,
        depth: number
      ) => {
        for await (const e of dir.values()) {
          if (paths.length >= maxFiles) return;
          if (e.name.startsWith('.')) continue;
          if (e.kind === 'file') paths.push(prefix + e.name);
          else if (depth < maxDepth)
            await walk(e, `${prefix}${e.name}/`, depth + 1);
        }
      };
      await walk(root, '', 1);
      return paths;
    },
  };
}

/**
 * Read/write permission for a remembered folder. Browsers forget it between
 * visits; asking again needs a click, so `ask` is true only in one.
 */
export async function permission(
  dir: DirectoryHandle,
  ask: boolean
): Promise<PermissionState> {
  const state = await dir.queryPermission({ mode: 'readwrite' });
  if (state === 'granted' || !ask) return state;
  return dir.requestPermission({ mode: 'readwrite' });
}
