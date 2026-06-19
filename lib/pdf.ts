import { extractText, getDocumentProxy } from "unpdf";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Render plain/markdown-ish notes text into a simple, readable A4 PDF.
// Lines starting with # become headings; -, * or • become bullets.
export async function notesToPdf(title: string, text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4 = { w: 595.28, h: 841.89 };
  const margin = 50;
  const maxW = A4.w - margin * 2;
  const dark = rgb(0.1, 0.1, 0.1);
  const teal = rgb(0.05, 0.58, 0.53);

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - margin;
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - margin; };
  const ensure = (need: number) => { if (y - need < margin) newPage(); };

  const wrap = (s: string, f: typeof font, size: number): string[] => {
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

  // pdf-lib's WinAnsi fonts can't encode every Unicode char; strip the rest.
  const safe = (s: string) => s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

  const draw = (s: string, f: typeof font, size: number, color = dark, indent = 0) => {
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

// Pull the text out of a PDF at a URL. Serverless-friendly (unpdf). Returns "" on
// failure so callers can fall back to manually-pasted text.
export async function extractPdfText(url: string): Promise<string> {
  try {
    const buf = await fetch(url, { cache: "no-store" }).then((r) => r.arrayBuffer());
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return (typeof text === "string" ? text : (text as string[]).join("\n")).trim();
  } catch {
    return "";
  }
}
