/**
 * Image headers, read the way pdfTeX reads them for \includegraphics: the
 * pixel size and resolution of PNG and JPEG files, and the page box of a PDF.
 * Pure: bytes in, numbers out.
 */

export type ImageInfo =
  | {
      type: 'png' | 'jpeg';
      widthPx: number;
      heightPx: number;
      /** Dots per inch, when the file states it. */
      dpiX?: number;
      dpiY?: number;
    }
  | {
      type: 'pdf';
      /** The first page's box in bp, when it can be found uncompressed. */
      widthBp?: number;
      heightBp?: number;
    };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image's type and size, or null for anything pdflatex can't include. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return png(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (latin1(bytes, 0, 5) === '%PDF-') return pdf(bytes);
  return null;
}

/**
 * The natural size in bp, as pdfTeX sets it: pixels over the stated
 * resolution, or \pdfimageresolution (72 dpi in TeX Live's
 * pdftexconfig.tex) when there is none. For a PDF, its page box.
 */
export function naturalSizeBp(
  info: ImageInfo
): { width: number; height: number } | null {
  if (info.type === 'pdf')
    return info.widthBp !== undefined && info.heightBp !== undefined
      ? { width: info.widthBp, height: info.heightBp }
      : null;
  return {
    width: (info.widthPx * 72) / (info.dpiX ?? 72),
    height: (info.heightPx * 72) / (info.dpiY ?? 72),
  };
}

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function latin1(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * IHDR for the size; pHYs (unit 1 = per metre) for the resolution. pdfTeX
 * rounds resolutions to whole dpi (as recalled from writepng.c/writejpg.c,
 * not re-read; fixtures/figure-basic measures the result).
 */
function png(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 33 || latin1(bytes, 12, 16) !== 'IHDR') return null;
  const v = view(bytes);
  const info: ImageInfo = {
    type: 'png',
    widthPx: v.getUint32(16),
    heightPx: v.getUint32(20),
  };
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = v.getUint32(at);
    const type = latin1(bytes, at + 4, at + 8);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'pHYs' && at + 17 <= bytes.length && bytes[at + 16] === 1) {
      info.dpiX = Math.round(v.getUint32(at + 8) * 0.0254);
      info.dpiY = Math.round(v.getUint32(at + 12) * 0.0254);
    }
    at += 12 + length;
  }
  return info;
}

/** SOFn for the size; JFIF APP0 for the resolution (units 1 dpi, 2 dpcm). */
function jpeg(bytes: Uint8Array): ImageInfo | null {
  const v = view(bytes);
  let dpiX: number | undefined;
  let dpiY: number | undefined;
  for (let at = 2; at + 4 <= bytes.length;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    const length = v.getUint16(at + 2);
    if (marker === 0xe0 && latin1(bytes, at + 4, at + 9) === 'JFIF\0') {
      const units = bytes[at + 11];
      const scale = units === 1 ? 1 : units === 2 ? 2.54 : 0;
      if (scale) {
        dpiX = Math.round(v.getUint16(at + 12) * scale);
        dpiY = Math.round(v.getUint16(at + 14) * scale);
      }
    }
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    const sof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (sof) {
      if (at + 9 > bytes.length) return null;
      return {
        type: 'jpeg',
        widthPx: v.getUint16(at + 7),
        heightPx: v.getUint16(at + 5),
        ...(dpiX !== undefined ? { dpiX, dpiY } : {}),
      };
    }
    at += 2 + length;
  }
  return null;
}

/**
 * pdfTeX includes a PDF's /CropBox, or its /MediaBox when there is none
 * (graphicx's default pagebox). Boxes inside compressed object streams
 * can't be read without inflating them, so the size is then unknown.
 */
function pdf(bytes: Uint8Array): ImageInfo {
  const text = latin1(bytes, 0, Math.min(bytes.length, 1 << 20));
  const box = (name: string) => {
    const m = new RegExp(
      `/${name}\\s*\\[\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\]`
    ).exec(text);
    if (!m) return null;
    const [x0, y0, x1, y1] = m.slice(1).map(Number);
    return { widthBp: Math.abs(x1 - x0), heightBp: Math.abs(y1 - y0) };
  };
  return { type: 'pdf', ...(box('CropBox') ?? box('MediaBox')) };
}
