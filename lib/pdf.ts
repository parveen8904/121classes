import { extractText, extractTextItems, getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// Noto Sans (covers ₹ and most Unicode) fetched once and cached in memory.
let fontCache: { reg: Uint8Array; bold: Uint8Array } | null = null;
let fontPromise: Promise<{ reg: Uint8Array; bold: Uint8Array } | null> | null = null;
async function loadNoto() {
  if (fontCache) return fontCache;
  if (!fontPromise) {
    const base = "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/";
    fontPromise = (async () => {
      const [r, b] = await Promise.all([
        fetch(base + "NotoSans-Regular.ttf").then((x) => x.arrayBuffer()),
        fetch(base + "NotoSans-Bold.ttf").then((x) => x.arrayBuffer()),
      ]);
      fontCache = { reg: new Uint8Array(r), bold: new Uint8Array(b) };
      return fontCache;
    })().catch(() => {
      fontPromise = null;
      return null;
    });
  }
  return fontPromise;
}

// Fallback transliteration (only used if the Unicode font fails to load) so a
// standard PDF font can still render the common symbols.
const translit = (s: string) =>
  s
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/[→⇒]/g, "->")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

// Render plain/markdown-ish notes text into a simple, readable A4 PDF.
// Lines starting with # become headings; -, * or • become bullets.
export async function notesToPdf(title: string, text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let font: PDFFont;
  let bold: PDFFont;
  let unicode = false;
  const noto = await loadNoto();
  if (noto) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(noto.reg, { subset: true });
    bold = await doc.embedFont(noto.bold, { subset: true });
    unicode = true;
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }

  const A4 = { w: 595.28, h: 841.89 };
  const margin = 50;
  const maxW = A4.w - margin * 2;
  const dark = rgb(0.1, 0.1, 0.1);
  const teal = rgb(0.05, 0.58, 0.53);

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - margin;
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - margin; };
  const ensure = (need: number) => { if (y - need < margin) newPage(); };

  const wrap = (s: string, f: PDFFont, size: number): string[] => {
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };

  // With the Unicode font we keep text as-is; otherwise transliterate to ASCII.
  const safe = (s: string) => (unicode ? s : translit(s));

  const draw = (s: string, f: PDFFont, size: number, color = dark, indent = 0) => {
    for (const ln of wrap(safe(s), f, size)) {
      ensure(size + 6);
      page.drawText(ln, { x: margin + indent, y: y - size, size, font: f, color });
      y -= size + 6;
    }
  };

  draw(title, bold, 18, teal);
  y -= 6;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r/g, "");
    if (!line.trim()) { y -= 8; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { y -= 6; draw(h[2], bold, h[1].length === 1 ? 15 : 13, dark); continue; }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      ensure(18);
      page.drawText("-", { x: margin, y: y - 11, size: 11, font, color: dark });
      draw(bullet[1].replace(/\*\*/g, ""), font, 11, dark, 14);
      continue;
    }
    draw(line.replace(/\*\*/g, ""), font, 11, dark);
  }

  return doc.save();
}

// ICAI/BoS PDFs draw the rupee sign with a custom font whose glyph extracts as
// a backtick — "` 1,551" really means "₹1,551". Backtick has no legitimate use
// in CA study material, so map it to ₹ and tidy the spacing before amounts.
// Also normalise ligatures/soft hyphens that PDF extraction leaves behind.
export function cleanPdfText(raw: string): string {
  return raw
    .replace(/`/g, "₹")
    .replace(/₹\s+(?=[\d.])/g, "₹")
    .replace(/­/g, "")            // soft hyphen
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/ﬀ/g, "ff").replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Pull the text out of a PDF at a URL. Serverless-friendly (unpdf). Returns "" on
// failure so callers can fall back to manually-pasted text.
/**
 * The text of a PDF, ONE STRING PER PAGE.
 *
 * Needed to decide what NOT to show a student. His answer keys end with a page
 * or two of errata — corrections to the printed booklet — which belong to him
 * and his printer, not to a student comparing their working against the model
 * answer. Deciding that needs to know which page says what.
 */
export async function extractPdfPageTexts(url: string): Promise<string[]> {
  try {
    const { resolveFileUrl } = await import("@/lib/storage");
    const fetchable = await resolveFileUrl(url);
    if (!fetchable) return [];
    const buf = await fetch(fetchable, { cache: "no-store" }).then((r) => r.arrayBuffer());
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text.map((t) => String(t ?? "")) : [];
  } catch {
    return [];
  }
}

/**
 * How many pages at the END of a key are errata rather than answers.
 *
 * Counted from the back and stopping at the first page that is not: an "errata"
 * mentioned in the middle of a worked solution is part of the answer, and
 * dropping that page would take a student's model answer away with it.
 */
export function trailingErrataPages(pageTexts: string[]): number {
  const looksErrata = (t: string) => {
    const head = t.slice(0, 400).toLowerCase();
    return /\berrata\b|\bcorrigend(um|a)\b|\bcorrections? to the (booklet|book|printed)/.test(head);
  };
  let n = 0;
  for (let i = pageTexts.length - 1; i >= 0; i--) {
    if (!looksErrata(pageTexts[i])) break;
    n++;
  }
  return n;
}

/* ═══════════════════════════════════════════════════════════════════════════
   READING A PDF, AND SAYING WHAT WENT WRONG WHEN IT CANNOT BE READ
   ═══════════════════════════════════════════════════════════════════════════

   His report, 2 September 2026: "I tried uploading the PDF for my credit cards
   as well as my bank statements which were not excel sheet and you did not
   properly understand it. Why are you unable to read it?"

   Three statements failed that afternoon — the Axis 8882 card, and the NRE and
   NRO accounts — and every one of them came back saying:

       "could not read text from this PDF (scanned images?)"

   That sentence was a GUESS, and a bad one. extractPdfText caught every
   possible failure and returned an empty string, so the caller had exactly one
   fact — no text — and invented a cause for it. A file that could not be
   fetched, a file that was not a PDF, a corrupt file and a PASSWORD-PROTECTED
   file all arrived at the same wrong sentence.

   Axis statements downloaded from netbanking and from the mobile app are
   encrypted as a matter of course — the file name of the one that failed,
   "AXISMB_…PARV8882.pdf", is the mobile app's own export. pdf.js throws a
   PasswordException for those, which we were swallowing and reporting as
   scanned images. Nobody could have got from that message to the answer.

   So: every failure now names itself, a password can be supplied, and "the
   text layer is genuinely empty" is one specific outcome rather than the
   catch-all.
*/
export type PdfRead =
  | { ok: true; text: string; pages: number }
  | { ok: false; reason: string; needsPassword?: boolean };

/** pdf.js reports the reason in `name`; the message alone is not enough. */
const pdfErrorName = (e: unknown): string =>
  (e as { name?: string })?.name ?? (e instanceof Error ? e.name : "");

export async function readPdf(url: string, opts?: { password?: string }): Promise<PdfRead> {
  let buf: ArrayBuffer;
  try {
    const { resolveFileUrl } = await import("@/lib/storage");
    const fetchable = await resolveFileUrl(url);
    if (!fetchable) return { ok: false, reason: "the stored file could not be located" };
    const r = await fetch(fetchable, { cache: "no-store" });
    if (!r.ok) return { ok: false, reason: `the file could not be downloaded (${r.status})` };
    buf = await r.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: `the file could not be downloaded — ${e instanceof Error ? e.message : "unknown error"}` };
  }

  if (buf.byteLength === 0) return { ok: false, reason: "the file is empty" };
  // "%PDF" — a renamed .xls or a half-finished download is a common upload and
  // says nothing useful about text layers.
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
  if (!head.startsWith("%PDF")) {
    return { ok: false, reason: "this is not a PDF file — it may have been renamed, or the download did not finish" };
  }

  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf), opts?.password ? { password: opts.password } : undefined);
    const { text } = await extractText(pdf, { mergePages: true });
    const out = cleanPdfText(typeof text === "string" ? text : (text as string[]).join("\n"));
    if (!out.replace(/\s/g, "")) {
      return {
        ok: false,
        reason: `the PDF opened but carries no text — its ${pdf.numPages} page(s) are images, so it is a scan or a screenshot`,
      };
    }
    return { ok: true, text: out, pages: pdf.numPages };
  } catch (e) {
    const name = pdfErrorName(e);
    if (name === "PasswordException") {
      return {
        ok: false,
        needsPassword: true,
        reason: opts?.password
          ? "that password did not open the PDF"
          : "this PDF is password-protected — Axis statements from netbanking and the mobile app are encrypted by default",
      };
    }
    if (name === "InvalidPDFException") return { ok: false, reason: "the PDF is damaged and cannot be opened" };
    return { ok: false, reason: `the PDF could not be read — ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

/**
 * THE PDF AS A TABLE, NOT AS PROSE.
 *
 * Every fragment in a PDF carries an x and a y, so a statement's columns are
 * still there — they are simply not in the string you get from extractText.
 * Putting them back means a PDF statement can go through the same parser as
 * the Excel one instead of being handed to a model as one long line.
 * See lib/pdfTable.ts for the rules.
 */
export async function readPdfRows(url: string, opts?: { password?: string }): Promise<
  { ok: true; rows: string[][]; pages: number } | { ok: false; reason: string; needsPassword?: boolean }
> {
  let buf: ArrayBuffer;
  try {
    const { resolveFileUrl } = await import("@/lib/storage");
    const fetchable = await resolveFileUrl(url);
    if (!fetchable) return { ok: false, reason: "the stored file could not be located" };
    const r = await fetch(fetchable, { cache: "no-store" });
    if (!r.ok) return { ok: false, reason: `the file could not be downloaded (${r.status})` };
    buf = await r.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: `the file could not be downloaded — ${e instanceof Error ? e.message : "unknown error"}` };
  }
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
  if (!head.startsWith("%PDF")) {
    return { ok: false, reason: "this is not a PDF file — it may have been renamed, or the download did not finish" };
  }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf), opts?.password ? { password: opts.password } : undefined);
    const { items, totalPages } = await extractTextItems(pdf);
    const { pagesToRows } = await import("@/lib/pdfTable");
    const rows = pagesToRows(items as unknown as { str: string; x: number; y: number; width?: number; height?: number }[][]);
    if (!rows.length) {
      return { ok: false, reason: `the PDF opened but carries no text — its ${totalPages} page(s) are images, so it is a scan or a screenshot` };
    }
    return { ok: true, rows, pages: totalPages };
  } catch (e) {
    const name = pdfErrorName(e);
    if (name === "PasswordException") {
      return {
        ok: false, needsPassword: true,
        reason: opts?.password
          ? "that password did not open the PDF"
          : "this PDF is password-protected — Axis statements from netbanking and the mobile app are encrypted by default",
      };
    }
    if (name === "InvalidPDFException") return { ok: false, reason: "the PDF is damaged and cannot be opened" };
    return { ok: false, reason: `the PDF could not be read — ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

/**
 * THE PAGES OF A LOCKED PDF, AS PICTURES.
 *
 * His Axis credit-card statement, 2 September 2026: password-protected, and its
 * transaction table drawn as a picture. Every reader had an answer for one half
 * of that and not the other — the parsers need text and there is none, and the
 * page reader sends the FILE to the model, which would meet the same lock we
 * needed the password to get past. So it told him to "save an unlocked copy",
 * which is the portal asking him to do its job.
 *
 * pdf.js decrypts as it reads. extractImages hands back what is drawn on a page
 * as raw pixels — already decrypted, already ours — and encodePng puts them in
 * a container the model can open, with node's own zlib. No native canvas, no
 * unlocked copy, no asking.
 *
 * Only the biggest picture on each page is taken: a statement page is one large
 * scan, and the rest are the bank's logo and a signature block. Anything small
 * is left behind rather than sent as a page.
 */
/**
 * DRAW THE PAGES OURSELVES, THE WAY A READER'S SCREEN WOULD.
 *
 * The last resort, and the only one that reads a page holding neither text nor
 * pictures — a statement whose type has been converted to outlines is drawn
 * entirely as lines and shapes, so there is nothing in it to extract.
 *
 * pdf.js draws against browser globals. A Node canvas has every one of them;
 * they are simply not on globalThis, and without Path2D a vector page fails
 * with "Path2D is not defined" — which reads like a bug in the statement.
 * pdf.js also makes canvases of its own for masks and patterns, so it is given
 * a factory as well; without it an image on the page stops the whole render.
 */
async function renderPdfPages(bytes: Uint8Array, pages: number, password?: string): Promise<{ b64: string; page: number }[]> {
  const C = await import("@napi-rs/canvas");
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ["Path2D", "DOMMatrix", "ImageData"] as const) {
    if (!g[k] && (C as unknown as Record<string, unknown>)[k]) g[k] = (C as unknown as Record<string, unknown>)[k];
  }
  class NodeCanvasFactory {
    create(width: number, height: number) {
      const canvas = C.createCanvas(Math.ceil(width) || 1, Math.ceil(height) || 1);
      return { canvas, context: canvas.getContext("2d") };
    }
    reset(cc: { canvas: { width: number; height: number } }, width: number, height: number) {
      cc.canvas.width = Math.ceil(width) || 1; cc.canvas.height = Math.ceil(height) || 1;
    }
    destroy(cc: { canvas: { width: number; height: number } }) { cc.canvas.width = 0; cc.canvas.height = 0; }
  }

  const doc = await getDocumentProxy(bytes, {
    ...(password ? { password } : {}),
    CanvasFactory: NodeCanvasFactory,
  } as Parameters<typeof getDocumentProxy>[1]);

  const out: { b64: string; page: number }[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, pages); p++) {
    const page = await doc.getPage(p);
    // 2× so the type is legible to a reader that only gets pixels.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = C.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    // A PDF page is transparent; without this the type comes out black on black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    out.push({ b64: canvas.toBuffer("image/png").toString("base64"), page: p });
  }
  return out;
}

export async function readPdfPageImages(
  url: string,
  opts?: { password?: string; maxPages?: number },
): Promise<{ ok: true; images: { b64: string; page: number }[] } | { ok: false; reason: string }> {
  let buf: ArrayBuffer;
  try {
    const { resolveFileUrl } = await import("@/lib/storage");
    const fetchable = await resolveFileUrl(url);
    if (!fetchable) return { ok: false, reason: "the stored file could not be located" };
    const r = await fetch(fetchable, { cache: "no-store" });
    if (!r.ok) return { ok: false, reason: `the file could not be downloaded (${r.status})` };
    buf = await r.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: `the file could not be downloaded — ${e instanceof Error ? e.message : "unknown error"}` };
  }

  try {
    const { encodePng } = await import("@/lib/pngEncode");
    const pdf = await getDocumentProxy(new Uint8Array(buf), opts?.password ? { password: opts.password } : undefined);
    const { OPS } = await getResolvedPDFJS();
    const pages = Math.min(pdf.numPages, opts?.maxPages ?? 8);

    // WHAT WE ACTUALLY SAW, so a failure can be diagnosed instead of guessed at.
    let seen = 0, biggest = { w: 0, h: 0 };
    const out: { b64: string; page: number }[] = [];

    for (let p = 1; p <= pages; p++) {
      let found: { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 } | null = null;
      try {
        const page = await pdf.getPage(p);
        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length; i++) {
          const op = ops.fnArray[i];
          // EVERY WAY A PDF CAN PUT A PICTURE ON A PAGE, not just one.
          //
          // unpdf's own extractImages looks at paintImageXObject alone. A
          // black-and-white scan — which is how a bank scans — is usually an
          // image MASK, and a small one may be inline. Both were being skipped
          // in silence, which is a page that "carries no images" while plainly
          // being a picture.
          const isXObj = op === OPS.paintImageXObject;
          const isMask = op === OPS.paintImageMaskXObject;
          const isInline = op === OPS.paintInlineImageXObject;
          if (!isXObj && !isMask && !isInline) continue;

          const arg = ops.argsArray[i][0];
          let img: { data?: Uint8Array | Uint8ClampedArray; width?: number; height?: number } | null = null;
          if (isInline && arg && typeof arg === "object") {
            img = arg as { data?: Uint8Array; width?: number; height?: number };
          } else if (typeof arg === "string") {
            const store = arg.startsWith("g_") ? page.commonObjs : page.objs;
            img = await new Promise((res) => { try { store.get(arg, res); } catch { res(null); } });
          }
          if (!img?.data || !img.width || !img.height) continue;

          const w = img.width, h = img.height;
          seen++;
          if (w * h > biggest.w * biggest.h) biggest = { w, h };
          // A logo is a couple of hundred pixels; a scanned page is thousands.
          if (w < 300 || h < 300) continue;

          const per = img.data.length / (w * h);
          let data: Uint8Array | Uint8ClampedArray = img.data;
          let channels: 1 | 3 | 4;
          if (per === 1 || per === 3 || per === 4) {
            channels = per as 1 | 3 | 4;
          } else if (img.data.length >= Math.ceil(w / 8) * h) {
            // ONE BIT A PIXEL — a fax-style scan, packed eight to the byte and
            // padded to a byte at the end of every row. Unpacked to grey here,
            // because a PNG cannot carry it and the model cannot read it.
            const stride = Math.ceil(w / 8);
            const grey = new Uint8Array(w * h);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const bit = (img.data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
                // In an image mask a set bit is ink; in a 1-bit image it is white.
                grey[y * w + x] = isMask ? (bit ? 0 : 255) : (bit ? 255 : 0);
              }
            }
            data = grey;
            channels = 1;
          } else {
            continue;
          }
          if (!found || w * h > found.width * found.height) found = { data, width: w, height: h, channels };
        }
      } catch { /* a page that will not give up its images is skipped, not fatal */ }

      if (!found) continue;
      try {
        out.push({ b64: encodePng(found.data, found.width, found.height, found.channels).toString("base64"), page: p });
      } catch { /* an image we cannot honestly encode is left out */ }
    }

    // LAST OF ALL, DRAW THE PAGE OURSELVES.
    //
    // A page can carry no text AND no pictures — a statement whose type has
    // been converted to outlines is drawn entirely as lines and shapes. Nothing
    // can be extracted from it, because there is nothing in it to extract; it
    // has to be RENDERED, exactly as a reader's screen would.
    //
    // Kept last because it is the most expensive step and the one with a native
    // dependency, and wrapped so that a platform without that binary loses this
    // one route rather than the whole upload.
    if (!out.length) {
      try {
        const rendered = await renderPdfPages(new Uint8Array(buf), pages, opts?.password);
        out.push(...rendered);
      } catch { /* no renderer here — fall through to the explanation below */ }
    }

    if (!out.length) {
      // SAY WHAT WAS THERE. "Nothing could be lifted off" is true and useless;
      // whether a page held no pictures at all or held one too small to be a
      // page decides completely different next steps.
      const detail = seen === 0
        ? "its pages hold no text and no pictures — the statement is drawn as lines and shapes — and it could not be rendered here either"
        : `the ${seen} picture(s) on them are too small to be pages (largest ${biggest.w}×${biggest.h})`;
      return { ok: false, reason: `nothing could be read off its ${pdf.numPages} page(s): ${detail}` };
    }
    return { ok: true, images: out };
  } catch (e) {
    const name = pdfErrorName(e);
    if (name === "PasswordException") {
      return {
        ok: false,
        reason: opts?.password ? "that password did not open the PDF" : "this PDF is password-protected",
      };
    }
    return { ok: false, reason: `the pages could not be read as pictures — ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

/**
 * THE FILE ITSELF, FOR A PDF NOTHING CAN PARSE.
 *
 * When a statement's pages are pictures there is no text to work with, and the
 * only reader left is one that can look at a page. Claude reads a PDF sent as
 * a document block, so the bytes go as they are.
 *
 * An ENCRYPTED PDF cannot go: we can open it here with a password, but the
 * model receives the file and would meet the same lock. That is reported
 * rather than left to fail silently — the answer is to save an unlocked copy,
 * and nobody would guess that from a blank result.
 */
export async function readPdfBase64(url: string): Promise<
  { ok: true; b64: string; bytes: number } | { ok: false; reason: string }
> {
  try {
    const { resolveFileUrl } = await import("@/lib/storage");
    const fetchable = await resolveFileUrl(url);
    if (!fetchable) return { ok: false, reason: "the stored file could not be located" };
    const r = await fetch(fetchable, { cache: "no-store" });
    if (!r.ok) return { ok: false, reason: `the file could not be downloaded (${r.status})` };
    const buf = await r.arrayBuffer();
    // Anthropic's limit is 32MB; a statement is far smaller, and a file this
    // size is not a statement.
    if (buf.byteLength > 25 * 1024 * 1024) {
      return { ok: false, reason: `the PDF is ${(buf.byteLength / 1e6).toFixed(1)} MB, too large to read page by page` };
    }
    return { ok: true, b64: Buffer.from(buf).toString("base64"), bytes: buf.byteLength };
  } catch (e) {
    return { ok: false, reason: `the file could not be read — ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

/**
 * The older shape: text or "". Kept for the callers that only ever fell back to
 * pasted text and have nothing useful to do with a reason.
 */
export async function extractPdfText(url: string, opts?: { password?: string }): Promise<string> {
  const r = await readPdf(url, opts);
  return r.ok ? r.text : "";
}
