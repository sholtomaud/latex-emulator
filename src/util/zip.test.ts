import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateRawSync } from 'node:zlib';
import { zip, unzip } from './zip.ts';
import { deflateRawSync } from 'node:zlib';

/** A minimal reader, written from the spec (APPNOTE 4.3), to check what zip() writes. */
function read(archive: Uint8Array) {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  );
  const eocd = archive.length - 22;
  assert.strictEqual(view.getUint32(eocd, true), 0x06054b50, 'end record');
  const count = view.getUint16(eocd + 10, true);
  assert.strictEqual(view.getUint16(eocd + 8, true), count);
  const cdSize = view.getUint32(eocd + 12, true);
  let p = view.getUint32(eocd + 16, true);
  assert.strictEqual(p + cdSize, eocd, 'central directory ends at the record');
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.strictEqual(view.getUint32(p, true), 0x02014b50, 'central header');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const time = view.getUint16(p + 12, true);
    const date = view.getUint16(p + 14, true);
    const crc = view.getUint32(p + 16, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(
      archive.subarray(p + 46, p + 46 + nameLen)
    );
    // The local header must agree with the central one.
    assert.strictEqual(view.getUint32(local, true), 0x04034b50);
    assert.strictEqual(view.getUint16(local + 6, true), flags);
    assert.strictEqual(view.getUint16(local + 8, true), method);
    assert.strictEqual(view.getUint32(local + 14, true), crc);
    assert.strictEqual(view.getUint32(local + 18, true), compressed);
    assert.strictEqual(view.getUint32(local + 22, true), size);
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    const data = archive.subarray(start, start + compressed);
    const bytes = method === 8 ? new Uint8Array(inflateRawSync(data)) : data;
    assert.strictEqual(bytes.length, size);
    assert.strictEqual(crc32(bytes), crc, `${name}: CRC-32`);
    entries.push({ name, flags, method, time, date, bytes });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const text = (s: string) => new TextEncoder().encode(s);
const WHEN = new Date(2026, 10, 2, 8, 30, 10);

describe('zip', () => {
  test('writes every file, in order, with its bytes', async () => {
    const tex = text('\\documentclass{article}\n'.repeat(50));
    const noise = crypto.getRandomValues(new Uint8Array(2000));
    const entries = read(
      await zip(
        [
          { path: 'paper/paper.tex', bytes: tex },
          { path: 'paper/plots/energy.png', bytes: noise },
        ],
        WHEN
      )
    );
    assert.deepStrictEqual(
      entries.map((e) => e.name),
      ['paper/paper.tex', 'paper/plots/energy.png']
    );
    assert.deepStrictEqual(entries[0].bytes, tex);
    assert.deepStrictEqual(entries[1].bytes, noise);
  });

  test('deflates what shrinks and stores what does not (PNG, JPEG)', async () => {
    const [tex, png] = read(
      await zip(
        [
          { path: 'a.tex', bytes: text('x'.repeat(1000)) },
          {
            path: 'b.png',
            bytes: crypto.getRandomValues(new Uint8Array(500)),
          },
        ],
        WHEN
      )
    );
    assert.strictEqual(tex.method, 8);
    assert.strictEqual(png.method, 0);
  });

  test('stores an empty file', async () => {
    const [e] = read(
      await zip([{ path: 'empty.bib', bytes: new Uint8Array() }])
    );
    assert.strictEqual(e.method, 0);
    assert.strictEqual(e.bytes.length, 0);
  });

  test('marks UTF-8 names (general purpose flag bit 11)', async () => {
    const [plain, accented] = read(
      await zip([
        { path: 'a.tex', bytes: text('a') },
        { path: 'résumé.tex', bytes: text('b') },
      ])
    );
    assert.strictEqual(plain.flags & 0x0800, 0x0800);
    assert.strictEqual(accented.name, 'résumé.tex');
  });

  test('stamps the given time in MS-DOS form', async () => {
    const [e] = read(await zip([{ path: 'a', bytes: text('a') }], WHEN));
    // 2026-11-02: (2026 - 1980) << 9 | 11 << 5 | 2
    assert.strictEqual(e.date, (46 << 9) | (11 << 5) | 2);
    // 08:30:10, in two-second units
    assert.strictEqual(e.time, (8 << 11) | (30 << 5) | 5);
  });

  test('the same input gives the same bytes', async () => {
    const files = [{ path: 'a.tex', bytes: text('hello '.repeat(20)) }];
    assert.deepStrictEqual(await zip(files, WHEN), await zip(files, WHEN));
  });

  test('an empty archive is just the end record', async () => {
    const archive = await zip([]);
    assert.strictEqual(archive.length, 22);
    assert.deepStrictEqual(read(archive), []);
  });

  test('refuses paths that would land outside the folder it unpacks into', async () => {
    for (const path of ['/etc/passwd', '../x.tex', 'a/../../x', 'a\\b', ''])
      await assert.rejects(zip([{ path, bytes: text('x') }]), /path/);
    await assert.rejects(
      zip([
        { path: 'a.tex', bytes: text('x') },
        { path: 'a.tex', bytes: text('y') },
      ]),
      /twice/
    );
  });
});

/** A one-file archive made by hand, so unzip() can be fed what zip() never writes. */
function handMade(
  name: string,
  data: Uint8Array,
  o: {
    method?: number;
    size?: number;
    crc?: number;
    compressed?: Uint8Array;
  } = {}
) {
  const enc = new TextEncoder().encode(name);
  const body = o.compressed ?? data;
  const local = new Uint8Array(30 + enc.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, o.method ?? 0, true);
  lv.setUint32(14, o.crc ?? crc32(data), true);
  lv.setUint32(18, body.length, true);
  lv.setUint32(22, o.size ?? data.length, true);
  lv.setUint16(26, enc.length, true);
  local.set(enc, 30);
  const central = new Uint8Array(46 + enc.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, o.method ?? 0, true);
  cv.setUint32(16, o.crc ?? crc32(data), true);
  cv.setUint32(20, body.length, true);
  cv.setUint32(24, o.size ?? data.length, true);
  cv.setUint16(28, enc.length, true);
  central.set(enc, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + body.length, true);
  const out = new Uint8Array(local.length + body.length + central.length + 22);
  out.set(local, 0);
  out.set(body, local.length);
  out.set(central, local.length + body.length);
  out.set(end, local.length + body.length + central.length);
  return out;
}

describe('unzip', () => {
  const text = (s: string) => new TextEncoder().encode(s);

  test('reads back what zip() writes, stored and deflated', async () => {
    const files = [
      { path: 'a.tex', bytes: text('hello '.repeat(200)) },
      { path: 'images/x.png', bytes: new Uint8Array([137, 80, 78, 71]) },
      { path: 'empty.txt', bytes: new Uint8Array() },
    ];
    const back = await unzip(await zip(files));
    assert.deepStrictEqual(
      back.map((f) => [f.path, [...f.bytes]]),
      files.map((f) => [f.path, [...f.bytes]])
    );
  });

  test('reads a deflated file from another writer', async () => {
    const data = text('abc'.repeat(100));
    const archive = handMade('x.txt', data, {
      method: 8,
      compressed: new Uint8Array(deflateRawSync(data)),
    });
    const [f] = await unzip(archive);
    assert.strictEqual(new TextDecoder().decode(f.bytes), 'abc'.repeat(100));
  });

  test('refuses what is not a zip, a bad CRC, a wrong size and unsafe paths', async () => {
    await assert.rejects(unzip(text('not a zip at all')), /not a zip/i);
    const data = text('hello');
    await assert.rejects(unzip(handMade('a.txt', data, { crc: 1 })), /damaged/);
    await assert.rejects(
      unzip(
        handMade('a.txt', data, {
          method: 8,
          size: 2,
          compressed: new Uint8Array(deflateRawSync(data)),
        })
      ),
      /damaged/
    );
    await assert.rejects(unzip(handMade('../evil', data)), /path/);
    await assert.rejects(
      unzip(handMade('a.txt', data, { method: 12 })),
      /method/
    );
  });

  test('stops inflating a file that grows past its declared size (zip bomb)', async () => {
    const big = new Uint8Array(4 * 1024 * 1024);
    const archive = handMade('bomb', big, {
      method: 8,
      size: 100,
      compressed: new Uint8Array(deflateRawSync(big)),
    });
    await assert.rejects(unzip(archive), /damaged/);
  });
});
