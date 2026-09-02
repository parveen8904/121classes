import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
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
