import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Turn a mock paper into something that looks like an examination paper.
//
// The text was right and the presentation was not: a student was reading an
// exam on a web page in a monospaced block. An exam paper has a centred head, a
// rule under it, the marks pushed to the right margin, a part heading a student
// can find by flicking, and page numbers — and it is PRINTED, because that is
// how it will be sat.
//
// Times is used, not Helvetica: ICAI's papers are set in a serif face and a
// student should recognise the thing in their hands.

// Helvetica and Times are WinAnsi fonts and pdf-lib THROWS on any character
// outside that set rather than dropping it — one rupee sign once destroyed an
// entire checked copy. Everything drawn goes through here.
function winAnsi(text: string): string {
  return String(text ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[–—]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[×✕]/g, "x")
    .replace(/ /g, " ")
    .replace(/[^\x20-\xFF]/g, "");
}

const PAGE_W = 595;   // A4
const PAGE_H = 842;
const LEFT = 56;
const RIGHT = 56;
const TOP = 64;
const BOTTOM = 56;
const WIDTH = PAGE_W - LEFT - RIGHT;

type Ctx = {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  pageNo: number;
  body: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  title: string;
};

function newPage(c: Ctx) {
  // Page number at the foot of the page we are leaving.
  c.page.drawText(winAnsi(String(c.pageNo)), {
    x: PAGE_W / 2 - 4, y: BOTTOM - 22, size: 9, font: c.body, color: rgb(0.35, 0.35, 0.35),
  });
  c.pageNo += 1;
  c.page = c.pdf.addPage([PAGE_W, PAGE_H]);
  c.y = PAGE_H - TOP;
  // A running head, so a loose sheet still says which paper it belongs to.
  c.page.drawText(winAnsi(c.title), { x: LEFT, y: PAGE_H - 40, size: 8, font: c.italic, color: rgb(0.45, 0.45, 0.45) });
  c.page.drawLine({
    start: { x: LEFT, y: PAGE_H - 46 }, end: { x: PAGE_W - RIGHT, y: PAGE_H - 46 },
    thickness: 0.4, color: rgb(0.8, 0.8, 0.8),
  });
}

function need(c: Ctx, space: number) {
  if (c.y - space < BOTTOM) newPage(c);
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = w; }
    else line = t;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** "[10 Marks]" or "(2 Marks)" at the end of a line — pushed to the right margin. */
const MARKS_TAIL = /\s*[\[(]\s*(\d+(?:\s*(?:\+|and)\s*\d+)?)\s*marks?\s*[\])]\s*$/i;

const CENTRED = /^(MOCK EXAMINATION|INTERMEDIATE EXAMINATION|FINAL EXAMINATION|PAPER \d|Time Allowed|Maximum Marks)/i;
const PART_HEAD = /^PART\s+(I|II|1|2)\b/i;
const SECTION_HEAD = /^(INSTRUCTIONS TO CANDIDATES|CASE SCENARIO\s*\d*|QUESTION\s+\d+|Q\.?\s*\d+\b)/i;

/** The question paper as a PDF a student can print and sit. */
export async function buildMockPaperPdf(input: {
  title: string;
  text: string;
  footer?: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const c: Ctx = {
    pdf,
    page: pdf.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - TOP,
    pageNo: 1,
    body: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    title: input.title,
  };

  const lines = String(input.text ?? "").split("\n");
  let inHeader = true;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (!line.trim()) { c.y -= 7; continue; }

    // The masthead: centred, until the first real section starts.
    if (inHeader && CENTRED.test(line.trim())) {
      const size = /^(MOCK EXAMINATION|PAPER \d)/i.test(line.trim()) ? 15 : 11;
      const font = /^(Time Allowed|Maximum Marks)/i.test(line.trim()) ? c.bold : c.bold;
      const t = winAnsi(line.trim());
      need(c, size + 8);
      c.page.drawText(t, { x: (PAGE_W - font.widthOfTextAtSize(t, size)) / 2, y: c.y, size, font });
      c.y -= size + 7;
      continue;
    }

    if (PART_HEAD.test(line.trim())) {
      inHeader = false;
      need(c, 44);
      c.y -= 10;
      const t = winAnsi(line.trim());
      c.page.drawText(t, { x: (PAGE_W - c.bold.widthOfTextAtSize(t, 13)) / 2, y: c.y, size: 13, font: c.bold });
      c.y -= 8;
      c.page.drawLine({
        start: { x: LEFT + 90, y: c.y }, end: { x: PAGE_W - RIGHT - 90, y: c.y },
        thickness: 0.8, color: rgb(0.2, 0.2, 0.2),
      });
      c.y -= 14;
      continue;
    }

    if (SECTION_HEAD.test(line.trim())) {
      inHeader = false;
      need(c, 30);
      c.y -= 6;
      // A question heading may still carry its marks — keep them on the right.
      const m = line.trim().match(MARKS_TAIL);
      const head = winAnsi(m ? line.trim().replace(MARKS_TAIL, "") : line.trim());
      c.page.drawText(head, { x: LEFT, y: c.y, size: 11.5, font: c.bold });
      if (m) {
        const tail = winAnsi(`[${m[1]} Marks]`);
        c.page.drawText(tail, { x: PAGE_W - RIGHT - c.bold.widthOfTextAtSize(tail, 10), y: c.y, size: 10, font: c.bold });
      }
      c.y -= 17;
      continue;
    }

    inHeader = false;

    // Marks at the end of an ordinary line go to the right margin, the way a
    // printed paper sets them.
    const m = line.match(MARKS_TAIL);
    const text = m ? line.replace(MARKS_TAIL, "") : line;

    // Preserve the indentation the writer used for sub-parts and figures.
    const indent = (raw.match(/^\s*/)?.[0].length ?? 0) > 2 ? 18 : 0;
    const rows = wrap(text, c.body, 10.5, WIDTH - indent);

    rows.forEach((r, i) => {
      need(c, 14);
      c.page.drawText(r, { x: LEFT + indent, y: c.y, size: 10.5, font: c.body });
      if (m && i === rows.length - 1) {
        const tail = winAnsi(`(${m[1]} Marks)`);
        c.page.drawText(tail, { x: PAGE_W - RIGHT - c.bold.widthOfTextAtSize(tail, 10), y: c.y, size: 10, font: c.bold });
      }
      c.y -= 14;
    });
  }

  // Close the last page.
  c.page.drawText(winAnsi(String(c.pageNo)), {
    x: PAGE_W / 2 - 4, y: BOTTOM - 22, size: 9, font: c.body, color: rgb(0.35, 0.35, 0.35),
  });
  if (input.footer) {
    c.page.drawText(winAnsi(input.footer), {
      x: LEFT, y: BOTTOM - 22, size: 8, font: c.italic, color: rgb(0.45, 0.45, 0.45),
    });
  }

  return pdf.save();
}
