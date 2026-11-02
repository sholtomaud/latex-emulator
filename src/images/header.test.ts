import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { imageInfo, naturalSizeBp } from './header.ts';

const u32 = (n: number) => [
  n >>> 24,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A PNG chunk (CRC not checked by the parser, so zeros). */
const chunk = (type: string, data: number[]) => [
  ...u32(data.length),
  ...ascii(type),
  ...data,
  0,
  0,
  0,
  0,
];
const png = (w: number, h: number, phys?: [number, number, number]) =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(w), ...u32(h), 8, 2, 0, 0, 0]),
    ...(phys ? chunk('pHYs', [...u32(phys[0]), ...u32(phys[1]), phys[2]]) : []),
    ...chunk('IDAT', [0]),
    ...chunk('IEND', []),
  ]);

const seg = (marker: number, data: number[]) => [
  0xff,
  marker,
  (data.length + 2) >> 8,
  (data.length + 2) & 255,
  ...data,
];
const jpeg = (w: number, h: number, jfif?: [number, number, number]) =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...(jfif
      ? seg(0xe0, [
          ...ascii('JFIF'),
          0,
          1,
          2,
          jfif[0],
          jfif[1] >> 8,
          jfif[1] & 255,
          jfif[2] >> 8,
          jfif[2] & 255,
          0,
          0,
        ])
      : []),
    ...seg(
      0xdb,
      Array.from({ length: 65 }, () => 1)
    ),
    ...seg(0xc2, [
      8,
      h >> 8,
      h & 255,
      w >> 8,
      w & 255,
      3,
      1,
      0x11,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
    ]),
    0xff,
    0xd9,
  ]);

/** imageInfo of a PNG or JPEG. */
const raster = (bytes: Uint8Array) => {
  const info = imageInfo(bytes);
  assert.ok(info && info.type !== 'pdf');
  return info;
};

describe('imageInfo', () => {
  test('PNG: size from IHDR, resolution from pHYs (pixels per metre)', () => {
    assert.deepEqual(imageInfo(png(300, 150, [11811, 11811, 1])), {
      type: 'png',
      widthPx: 300,
      heightPx: 150,
      dpiX: 300,
      dpiY: 300,
    });
  });

  test('PNG without pHYs, or with an aspect-only pHYs, has no resolution', () => {
    assert.deepEqual(imageInfo(png(10, 20)), {
      type: 'png',
      widthPx: 10,
      heightPx: 20,
    });
    assert.equal(raster(png(10, 20, [2, 1, 0])).dpiX, undefined);
  });

  test('JPEG: size from the SOF segment, resolution from JFIF', () => {
    assert.deepEqual(imageInfo(jpeg(640, 480, [1, 150, 150])), {
      type: 'jpeg',
      widthPx: 640,
      heightPx: 480,
      dpiX: 150,
      dpiY: 150,
    });
    // Dots per centimetre.
    assert.equal(raster(jpeg(640, 480, [2, 118, 118])).dpiX, 300);
    // Units 0 is an aspect ratio only.
    assert.equal(raster(jpeg(640, 480, [0, 1, 1])).dpiX, undefined);
    assert.equal(raster(jpeg(64, 48)).widthPx, 64);
  });

  test('PDF: the first page’s CropBox, else its MediaBox, in bp', () => {
    const pdf = (s: string) => Uint8Array.from(ascii(`%PDF-1.5\n${s}\n%%EOF`));
    assert.deepEqual(
      imageInfo(pdf('<< /Type /Page /MediaBox [0 0 200 100] >>')),
      { type: 'pdf', widthBp: 200, heightBp: 100 }
    );
    assert.deepEqual(
      imageInfo(
        pdf(
          '<< /Type /Page /MediaBox [0 0 612 792] /CropBox [10.5 20 110.5 70] >>'
        )
      ),
      { type: 'pdf', widthBp: 100, heightBp: 50 }
    );
    // Compressed object streams hide the box: a PDF of unknown size.
    assert.deepEqual(imageInfo(pdf('stream x endstream')), { type: 'pdf' });
  });

  test('anything else, or a truncated file, is not an image we take', () => {
    assert.equal(imageInfo(Uint8Array.from(ascii('<svg/>'))), null);
    assert.equal(imageInfo(Uint8Array.from(ascii('GIF89a'))), null);
    assert.equal(imageInfo(png(1, 1).slice(0, 20)), null);
    assert.equal(imageInfo(jpeg(1, 1).slice(0, 30)), null);
    assert.equal(imageInfo(new Uint8Array()), null);
  });
});

describe('naturalSizeBp (as pdfTeX: pixels / resolution, 72 dpi by default)', () => {
  test('uses the resolution, or 72 dpi', () => {
    assert.deepEqual(
      naturalSizeBp({
        type: 'png',
        widthPx: 300,
        heightPx: 150,
        dpiX: 300,
        dpiY: 150,
      }),
      { width: 72, height: 72 }
    );
    assert.deepEqual(
      naturalSizeBp({ type: 'jpeg', widthPx: 144, heightPx: 72 }),
      {
        width: 144,
        height: 72,
      }
    );
    assert.deepEqual(naturalSizeBp({ type: 'pdf', widthBp: 10, heightBp: 5 }), {
      width: 10,
      height: 5,
    });
    assert.equal(naturalSizeBp({ type: 'pdf' }), null);
  });
});
