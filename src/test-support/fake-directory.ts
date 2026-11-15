import type { DirectoryHandle } from '../workspace/fs-access.ts';

/** Test support: an in-memory stand-in for the File System Access API. */

/** Just enough of FileSystemDirectoryHandle, backed by a nested Map. */
export class FakeDir implements DirectoryHandle {
  readonly kind = 'directory' as const;
  name: string;
  entriesMap = new Map<string, FakeDir | FakeFile>();
  state: PermissionState = 'granted';
  asked = 0;
  constructor(name: string) {
    this.name = name;
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    const e = this.entriesMap.get(name);
    if (e instanceof FakeDir) return e;
    if (e || !o?.create) throw new DOMException('nope', 'NotFoundError');
    const d = new FakeDir(name);
    this.entriesMap.set(name, d);
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    const e = this.entriesMap.get(name);
    if (e instanceof FakeFile) return e;
    if (e || !o?.create) throw new DOMException('nope', 'NotFoundError');
    const f = new FakeFile(name);
    this.entriesMap.set(name, f);
    return f;
  }
  async *values() {
    yield* this.entriesMap.values();
  }
  async queryPermission(): Promise<PermissionState> {
    return this.state;
  }
  async requestPermission(): Promise<PermissionState> {
    this.asked++;
    this.state = 'granted';
    return this.state;
  }
}

export class FakeFile {
  readonly kind = 'file' as const;
  name: string;
  bytes = new Uint8Array();
  constructor(name: string) {
    this.name = name;
  }
  async getFile() {
    return new Blob([this.bytes as Uint8Array<ArrayBuffer>]);
  }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (b: Uint8Array) => void chunks.push(b),
      close: async () => {
        const size = chunks.reduce((n, c) => n + c.length, 0);
        this.bytes = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          this.bytes.set(c, at);
          at += c.length;
        }
      },
    };
  }
}
