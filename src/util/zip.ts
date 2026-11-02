/**
 * A small ZIP writer (PKWARE APPNOTE 6.3.x), so the project download needs no
 * dependency (ADR 0015, phase A). Deflate comes from the browser's own
 * CompressionStream('deflate-raw'); a file is stored instead when deflating
 * doesn't make it smaller (PNG and JPEG are already compressed). No ZIP64:
 * a project is far below 4 GB and 65,535 files. Pure: runs in Node tests.
 */

export interface ZipFile {
  /** Path inside the archive, with `/` between folders. */
  path: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** MS-DOS date and time fields, from the date's local time (as zip tools do). */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time:
      (d.getHours() << 11) |
      (d.getMinutes() << 5) |
      Math.floor(d.getSeconds() / 2),
  };
}

/** A relative path that can't escape the folder the archive is unpacked into. */
function checkPath(path: string): void {
  const parts = path.split('/');
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    parts.some((p) => p === '' || p === '.' || p === '..')
  )
    throw new Error(`Not a safe path inside a zip: “${path}”`);
}

const VERSION = 20; // 2.0: deflate and folders
const UTF8 = 0x0800; // general purpose bit 11: names are UTF-8

/** The archive's bytes. `modified` stamps every file (default: 1980-01-01). */
export async function zip(
  files: ZipFile[],
  modified = new Date(1980, 0, 1)
): Promise<Uint8Array<ArrayBuffer>> {
  const seen = new Set<string>();
  for (const f of files) {
    checkPath(f.path);
    if (seen.has(f.path)) throw new Error(`${f.path} is in the zip twice`);
    seen.add(f.path);
  }
  const { date, time } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = encoder.encode(f.path);
    const deflated = f.bytes.length ? await deflateRaw(f.bytes) : f.bytes;
    const stored = deflated.length >= f.bytes.length;
    const data = stored ? f.bytes : deflated;
    const crc = crc32(f.bytes);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8, true);
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, f.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, VERSION, true); // made by: MS-DOS-compatible attributes
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, UTF8, true);
    cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, f.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + end.length);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
