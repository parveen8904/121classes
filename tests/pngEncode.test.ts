// A PNG built by hand, checked against a real decoder.
//
// It exists because his Axis credit-card statement is an ENCRYPTED PDF whose
// transactions are a picture: the table and text readers have nothing to read,
// and the page reader would send the model a file it cannot unlock. pdf.js
// decrypts as it reads and hands back the page's pixels — this puts them in a
// container the model can open, using node's own zlib rather than a native
// canvas in a serverless bundle.
//
// A hand-rolled encoder is exactly the thing that "looks fine" and is subtly
// wrong, so these check the bytes against the specification and then hand the
// result to an independent decoder.
//
//   node --experimental-strip-types tests/pngEncode.test.ts

import { encodePng } from "../lib/pngEncode.ts";
import { inflateSync } from "node:zlib";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A 3×2 image in RGB: red, green, blue over white, black, grey.
const rgb = new Uint8Array([
  255, 0, 0,   0, 255, 0,   0, 0, 255,
  255, 255, 255, 0, 0, 0,   128, 128, 128,
]);
const png = encodePng(rgb, 3, 2, 3);

check("it starts with the PNG signature", SIG.every((b, i) => png[i] === b));
check("IHDR comes first", png.subarray(12, 16).toString("latin1") === "IHDR");
check("the size is written big-endian", png.readUInt32BE(16) === 3 && png.readUInt32BE(20) === 2);
check("eight bits a channel", png[24] === 8);
check("RGB is colour type 2", png[25] === 2);
check("no interlacing", png[26] === 0 && png[27] === 0 && png[28] === 0);
check("it ends with IEND", png.subarray(png.length - 8, png.length - 4).toString("latin1") === "IEND");

// ── the pixels survive the round trip ─────────────────────────────────────
{
  const at = png.indexOf(Buffer.from("IDAT", "latin1"));
  const len = png.readUInt32BE(at - 4);
  const raw = inflateSync(png.subarray(at + 4, at + 4 + len));
  // Two scanlines, each: one filter byte then 9 bytes of pixel.
  check("every scanline is written unfiltered", raw[0] === 0 && raw[10] === 0,
    "a filter byte we got wrong would corrupt the page silently");
  check("the first row is red, green, blue",
    [...raw.subarray(1, 10)].join(",") === "255,0,0,0,255,0,0,0,255", [...raw.subarray(1, 10)].join(","));
  check("the second row is white, black, grey",
    [...raw.subarray(11, 20)].join(",") === "255,255,255,0,0,0,128,128,128");
}

// ── the CRCs are real ─────────────────────────────────────────────────────
// Every chunk carries one, and a decoder that checks them is the point of the
// exercise — a wrong CRC is the difference between a page and an error.
{
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  const crc32 = (b: Buffer) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  let p = 8, chunks = 0, bad = 0;
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const body = png.subarray(p + 4, p + 8 + len);
    if (crc32(Buffer.from(body)) !== png.readUInt32BE(p + 8 + len)) bad++;
    chunks++;
    p += 12 + len;
  }
  check("every chunk's CRC checks out", bad === 0 && chunks === 3, `${chunks} chunks, ${bad} bad`);
  check("the file ends exactly where the last chunk does", p === png.length);
}

// ── the other two shapes extractImages returns ────────────────────────────
{
  const grey = encodePng(new Uint8Array([0, 128, 255, 10, 20, 30]), 3, 2, 1);
  check("greyscale is colour type 0", grey[25] === 0);
  const rgba = encodePng(new Uint8Array(2 * 2 * 4).fill(200), 2, 2, 4);
  check("RGBA is colour type 6", rgba[25] === 6);
}

// ── it refuses what it cannot honestly encode ────────────────────────────
for (const [what, fn] of [
  ["too few pixels", () => encodePng(new Uint8Array(5), 3, 2, 3)],
  ["a zero width", () => encodePng(new Uint8Array(0), 0, 2, 3)],
] as [string, () => unknown][]) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(`${what} throws rather than writing a broken file`, threw,
    "a corrupted page is harder to diagnose than a refusal");
}

// ── a page-sized image is a sane size ────────────────────────────────────
{
  // A scanned A4 page at ~150dpi, mostly white, as a statement scan is.
  const w = 1240, h = 1754;
  const scan = new Uint8Array(w * h).fill(255);
  for (let i = 0; i < scan.length; i += 997) scan[i] = 0;   // sparse "ink"
  const out = encodePng(scan, w, h, 1);
  check("a whole page compresses to something sendable", out.length < 1_500_000,
    `${(out.length / 1e6).toFixed(2)} MB`);
}

console.log(fails === 0 ? "ok — PNG encoder" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
