import { extractText, getDocumentProxy } from "unpdf";
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
export async function extractPdfText(url: string): Promise<string> {
  try {
    const buf = await fetch(url, { cache: "no-store" }).then((r) => r.arrayBuffer());
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return cleanPdfText(typeof text === "string" ? text : (text as string[]).join("\n"));
  } catch {
    return "";
  }
}
