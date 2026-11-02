import { inflateRawSync } from 'node:zlib';

/** Read a .zip's files (stored or deflated), from its central directory. */
export function unzip(archive: Buffer): Map<string, Buffer> {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not a zip: no end of central directory');
  const count = archive.readUInt16LE(eocd + 10);
  let p = archive.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = archive.readUInt16LE(p + 10);
    const compressed = archive.readUInt32LE(p + 20);
    const nameLen = archive.readUInt16LE(p + 28);
    const extraLen = archive.readUInt16LE(p + 30);
    const commentLen = archive.readUInt16LE(p + 32);
    const local = archive.readUInt32LE(p + 42);
    const name = archive.toString('utf8', p + 46, p + 46 + nameLen);
    const start =
      local +
      30 +
      archive.readUInt16LE(local + 26) +
      archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + compressed);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
