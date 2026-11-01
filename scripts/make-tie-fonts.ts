/**
 * Tiny fonts for TeX's tie (~). Latin Modern's no-break space (U+00A0) is
 * figure-width (0.5em in LM Roman 10), but a tie in TeX is an ordinary
 * interword space (0.333em). Each font here holds one blank U+00A0 glyph
 * whose advance is the space width of a Latin Modern face, and is declared
 * for that face with `unicode-range: U+00A0` (document-css.ts), so ties keep
 * their no-break behaviour and get TeX's width. These are our own fonts, not
 * modified Latin Modern ones.
 *
 *   node scripts/make-tie-fonts.ts
 *
 * Writes src/assets/fonts/tie-<width>.ttf for each width below (the space
 * advance, in 1/1000 em, of the Latin Modern faces we ship).
 */
import { writeFileSync } from 'node:fs';

export const TIE_WIDTHS = [302, 326, 333, 350, 358, 367, 375, 378, 383, 414];

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number) {
    return this.u16(Math.floor(v / 0x10000) & 0xffff).u16(v & 0xffff);
  }
  tag(t: string) {
    for (const c of t) this.u8(c.charCodeAt(0));
    return this;
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.u8(0);
    return this;
  }
}

const table = (fill: (w: Writer) => void) => {
  const w = new Writer();
  fill(w);
  return w.bytes;
};

function checksum(bytes: number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4)
    sum =
      (sum +
        ((bytes[i] << 24) |
          ((bytes[i + 1] ?? 0) << 16) |
          ((bytes[i + 2] ?? 0) << 8) |
          (bytes[i + 3] ?? 0))) >>>
      0;
  return sum;
}

function nameTable(strings: Record<number, string>): number[] {
  const ids = Object.keys(strings).map(Number);
  const data: number[] = [];
  const records: [number, number, number][] = [];
  for (const id of ids) {
    const start = data.length;
    for (const c of strings[id]) data.push(0, c.charCodeAt(0)); // UTF-16BE (ASCII)
    records.push([id, data.length - start, start]);
  }
  return table((w) => {
    w.u16(0)
      .u16(ids.length)
      .u16(6 + 12 * ids.length);
    for (const [id, length, offset] of records)
      w.u16(3).u16(1).u16(0x409).u16(id).u16(length).u16(offset);
    for (const b of data) w.u8(b);
  });
}

/** A TrueType font with .notdef and a blank U+00A0 of `advance`/1000 em. */
export function tieFont(advance: number): Uint8Array {
  const tables: Record<string, number[]> = {
    head: table((w) =>
      w
        .u32(0x00010000) // version
        .u32(0x00010000) // fontRevision
        .u32(0) // checkSumAdjustment (filled in below)
        .u32(0x5f0f3cf5) // magic
        .u16(0x000b) // flags
        .u16(1000) // unitsPerEm
        .zeros(16) // created, modified
        .i16(0)
        .i16(0)
        .i16(0)
        .i16(0) // bounding box
        .u16(0) // macStyle
        .u16(8) // lowestRecPPEM
        .i16(2) // fontDirectionHint
        .i16(0) // indexToLocFormat: short
        .i16(0)
    ),
    hhea: table(
      (w) =>
        w
          .u32(0x00010000)
          .i16(806) // ascender: Latin Modern's own metrics
          .i16(-194) // descender
          .i16(0) // lineGap
          .u16(advance) // advanceWidthMax
          .i16(0)
          .i16(0)
          .i16(0)
          .i16(1) // caretSlopeRise
          .i16(0)
          .i16(0)
          .zeros(8)
          .i16(0) // metricDataFormat
          .u16(2) // numberOfHMetrics
    ),
    // maxp 1.0: numGlyphs, then 13 zeroed limits except maxZones (2).
    maxp: table((w) =>
      w.u32(0x00010000).u16(2).u16(0).u16(0).u16(0).u16(0).u16(2).zeros(16)
    ),
    hmtx: table((w) => w.u16(advance).i16(0).u16(advance).i16(0)),
    cmap: table((w) => {
      // One format-4 subtable: U+00A0 → glyph 1, then the 0xFFFF terminator.
      w.u16(0).u16(1).u16(3).u16(1).u32(12);
      w.u16(4).u16(32).u16(0).u16(4).u16(4).u16(1).u16(0);
      w.u16(0xa0).u16(0xffff); // endCode
      w.u16(0); // reservedPad
      w.u16(0xa0).u16(0xffff); // startCode
      w.i16(1 - 0xa0).i16(1); // idDelta
      w.u16(0).u16(0); // idRangeOffset
    }),
    'OS/2': table(
      (w) =>
        w
          .u16(4) // version
          .i16(advance) // xAvgCharWidth
          .u16(400) // usWeightClass
          .u16(5) // usWidthClass
          .u16(0) // fsType: installable
          .zeros(20) // sub/superscript sizes and offsets, strikeout
          .i16(0) // sFamilyClass
          .zeros(10) // panose
          .u32(0b10) // ulUnicodeRange1: Latin-1 Supplement
          .u32(0)
          .u32(0)
          .u32(0)
          .tag('NONE') // achVendID
          .u16(0x40) // fsSelection: REGULAR
          .u16(0xa0) // usFirstCharIndex
          .u16(0xa0) // usLastCharIndex
          .i16(806) // sTypoAscender
          .i16(-194) // sTypoDescender
          .i16(0) // sTypoLineGap
          .u16(806) // usWinAscent
          .u16(194) // usWinDescent
          .u32(1) // ulCodePageRange1: Latin 1
          .u32(0)
          .i16(0) // sxHeight
          .i16(0) // sCapHeight
          .u16(0) // usDefaultChar
          .u16(0x20) // usBreakChar
          .u16(0) // usMaxContext
    ),
    post: table((w) => w.u32(0x00030000).zeros(28)),
    name: nameTable({
      1: 'LaTeX Emulator Tie',
      2: 'Regular',
      3: `LaTeXEmulatorTie-${advance}`,
      4: `LaTeX Emulator Tie ${advance}`,
      5: 'Version 1.0',
      6: `LaTeXEmulatorTie-${advance}`,
    }),
    // Both glyphs are empty (loca offsets all 0). The glyf table itself
    // can't be empty: Chromium's font sanitiser (OTS) rejects a zero-length
    // glyf, so it holds four unused bytes.
    glyf: [0, 0, 0, 0],
    loca: table((w) => w.u16(0).u16(0).u16(0)),
  };

  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  const header = new Writer()
    .u32(0x00010000)
    .u16(n)
    .u16(searchRange)
    .u16(entrySelector)
    .u16(n * 16 - searchRange);
  let offset = 12 + 16 * n;
  const body: number[] = [];
  const directory = new Writer();
  let headOffset = 0;
  for (const tag of tags) {
    const data = tables[tag];
    if (tag === 'head') headOffset = offset;
    directory
      .tag(tag.padEnd(4))
      .u32(checksum(data))
      .u32(offset)
      .u32(data.length);
    const padded = [
      ...data,
      ...Array.from({ length: (4 - (data.length % 4)) % 4 }, () => 0),
    ];
    body.push(...padded);
    offset += padded.length;
  }
  const font = [...header.bytes, ...directory.bytes, ...body];
  const adjust = (0xb1b0afba - checksum(font)) >>> 0;
  font[headOffset + 8] = adjust >>> 24;
  font[headOffset + 9] = (adjust >>> 16) & 0xff;
  font[headOffset + 10] = (adjust >>> 8) & 0xff;
  font[headOffset + 11] = adjust & 0xff;
  return Uint8Array.from(font);
}

if (import.meta.main) {
  for (const width of TIE_WIDTHS) {
    const path = new URL(
      `../src/assets/fonts/tie-${width}.ttf`,
      import.meta.url
    );
    writeFileSync(path, tieFont(width));
    console.log(`wrote ${path.pathname}`);
  }
}
