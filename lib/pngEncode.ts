// RAW PIXELS → A PNG, WITH NOTHING INSTALLED.
//
// Why this exists, 2 September 2026. His Axis credit-card statement is a
// PASSWORD-PROTECTED PDF whose transaction table is drawn as a picture. Every
// reader on the desk had an answer for one half of that and not the other:
//
//   · the table rebuild and the text reader need text, and there is none
//   · the page reader sends the FILE to the model, and the model would meet
//     the same lock we needed a password to get past
//
// So it said "save an unlocked copy and upload again", which is the portal
// asking him to do its job — exactly what he had already objected to.
//
// pdf.js decrypts as it reads, and unpdf's extractImages hands back the page's
// picture as raw pixels: already decrypted, already ours. All that is missing
// is a container the model can read. Encoding a PNG by hand is about eighty
// lines and needs only node's own zlib — against pulling a native canvas into
// a serverless bundle to draw a picture we have already got.
//
// Nothing here imports anything but node:zlib, so it can be run by a test.

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 1 = grey, 3 = RGB, 4 = RGBA — the three shapes extractImages returns. */
export type Channels = 1 | 3 | 4;

const COLOUR_TYPE: Record<Channels, number> = { 1: 0, 3: 2, 4: 6 };

/**
 * An 8-bit PNG from raw, row-major pixel data.
 *
 * Every scanline is written with filter byte 0 (none). Filtering would shrink
 * the file, and this file is read once by a model and thrown away — the cost of
 * getting a predictor subtly wrong is a corrupted page nobody can debug.
 */
export function encodePng(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: Channels): Buffer {
  if (width <= 0 || height <= 0) throw new Error("a PNG needs a positive width and height");
  const expected = width * height * channels;
  if (pixels.length < expected) {
    throw new Error(`expected ${expected} bytes of pixel data, got ${pixels.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;                        // bit depth
  ihdr[9] = COLOUR_TYPE[channels];    // colour type
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // deflate, adaptive filtering, no interlace

  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;        // filter: none
    Buffer.from(pixels.buffer ?? pixels, pixels.byteOffset ?? 0, pixels.length)
      .copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
