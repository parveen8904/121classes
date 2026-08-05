import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";

// Turn a mock paper into something that looks like an examination paper.
//
// The first version drew every line of the source as its own line in the PDF.
// But the writer hard-wraps at about eighty characters, so a paragraph arrived
// as a column of ragged stubs — left-aligned, uneven, and nothing like a
// printed paper. The text was never the problem.
//
// So: consecutive lines are joined back into PARAGRAPHS, re-wrapped to the
// page measure and JUSTIFIED, the way a printed exam paper sets its prose.
// Lines that must not be re-flowed — numbered instructions, and any line laid
// out in columns of figures — are detected and kept exactly as written.
//
// Times, not Helvetica: ICAI sets in a serif face and a student should
// recognise the thing in their hands.

// Times is a WinAnsi font and pdf-lib THROWS on any character outside that set
// rather than dropping it — one rupee sign once destroyed a whole checked copy.
function winAnsi(text: string): string {
  return String(text ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[×✕]/g, "x")
    .replace(/ /g, " ")
    .replace(/[^\x20-\xFF]/g, "");
}

const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 62;
const RIGHT = 62;
const TOP = 70;
const BOTTOM = 62;
const WIDTH = PAGE_W - LEFT - RIGHT;
const BODY = 10.5;
const LEAD = 14.5;

type Ctx = {
  pdf: PDFDocument; page: PDFPage; y: number; pageNo: number;
  body: PDFFont; bold: PDFFont; italic: PDFFont; mono: PDFFont; title: string; attempt: string;
};

// A watermark across every page, of the paper AND of the answers.
//
// These papers are set to be given away, which is exactly why they need a name
// on them: a paper worth downloading is a paper worth another teacher passing
// off as their own. Diagonal, pale enough to read straight through, dark enough
// to survive a photocopy and to be obvious in a screenshot.
function stamp(c: Ctx, attempt: string) {
  const lines = ["CA PARVEEN SHARMA", attempt];
  const A = Math.PI / 4;                       // 45 degrees
  const along = { x: Math.cos(A), y: Math.sin(A) };   // direction the text runs
  const perp = { x: Math.sin(A), y: -Math.cos(A) };   // across the lines

  // The diagonal of an A4 page is about 730pt of usable run; size the text to
  // fit it rather than trusting a number, or the longer line walks off the edge.
  const longest = Math.max(...lines.map((t) => c.bold.widthOfTextAtSize(winAnsi(t), 100)));
  const size = Math.min(42, Math.floor((560 / longest) * 100));  // 560 leaves a clear margin at both corners

  lines.forEach((text, i) => {
    const t = winAnsi(text);
    const w = c.bold.widthOfTextAtSize(t, size);
    // Each line is centred on the page centre, stepped ACROSS the diagonal so
    // the two stay parallel instead of sliding down the page.
    const off = (i - (lines.length - 1) / 2) * (size * 1.5);
    const midX = PAGE_W / 2 + perp.x * off;
    const midY = PAGE_H / 2 + perp.y * off;
    c.page.drawText(t, {
      x: midX - (w / 2) * along.x,
      y: midY - (w / 2) * along.y,
      size,
      font: c.bold,
      rotate: degrees(45),
      color: rgb(0.55, 0.6, 0.62),
      opacity: 0.15,
    });
  });
}

function foot(c: Ctx) {
  const n = winAnsi(String(c.pageNo));
  c.page.drawText(n, { x: (PAGE_W - c.body.widthOfTextAtSize(n, 9)) / 2, y: BOTTOM - 26, size: 9, font: c.body, color: rgb(0.4, 0.4, 0.4) });
}

function newPage(c: Ctx) {
  foot(c);
  c.pageNo += 1;
  c.page = c.pdf.addPage([PAGE_W, PAGE_H]);
  c.y = PAGE_H - TOP;
  stamp(c, c.attempt);
  const h = winAnsi(c.title);
  c.page.drawText(h, { x: LEFT, y: PAGE_H - 44, size: 8, font: c.italic, color: rgb(0.45, 0.45, 0.45) });
  c.page.drawLine({ start: { x: LEFT, y: PAGE_H - 50 }, end: { x: PAGE_W - RIGHT, y: PAGE_H - 50 }, thickness: 0.4, color: rgb(0.78, 0.78, 0.78) });
}

function need(c: Ctx, space: number) {
  if (c.y - space < BOTTOM) newPage(c);
}

function words(s: string): string[] {
  return winAnsi(s).split(/\s+/).filter(Boolean);
}

/** Wrap to the measure, returning lines of words so they can be justified. */
function layout(ws: string[], font: PDFFont, size: number, maxW: number): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const w of ws) {
    const trial = [...cur, w].join(" ");
    if (cur.length && font.widthOfTextAtSize(trial, size) > maxW) { lines.push(cur); cur = [w]; }
    else cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Draw one line; justified spreads the words to both margins. */
function drawLine(c: Ctx, ws: string[], x: number, maxW: number, font: PDFFont, size: number, justify: boolean) {
  const text = ws.join(" ");
  if (!justify || ws.length < 2) {
    c.page.drawText(text, { x, y: c.y, size, font });
    return;
  }
  const natural = font.widthOfTextAtSize(text, size);
  const slack = maxW - natural;
  // Never stretch a short line into a gappy mess — that looks worse than ragged.
  if (slack <= 0 || slack > maxW * 0.28) {
    c.page.drawText(text, { x, y: c.y, size, font });
    return;
  }
  const gap = slack / (ws.length - 1);
  let cx = x;
  ws.forEach((w, i) => {
    c.page.drawText(w, { x: cx, y: c.y, size, font });
    cx += font.widthOfTextAtSize(w, size) + font.widthOfTextAtSize(" ", size) + (i < ws.length - 1 ? gap : 0);
  });
}

const MARKS_TAIL = /\s*[[(]\s*(\d+(?:\s*(?:\+|and)\s*\d+)?)\s*marks?\s*[\])]\s*$/i;
const CENTRED_HEAD = /^(MOCK EXAMINATION|INTERMEDIATE EXAMINATION|FINAL EXAMINATION|PAPER \d|Time Allowed|Maximum Marks)/i;
const PART_HEAD = /^PART\s+(I|II|1|2)\b/i;
const SECTION_HEAD = /^(INSTRUCTIONS TO CANDIDATES|CASE SCENARIO\s*\d*|QUESTION\s+\d+|Q\.?\s*\d+\b)/i;
const NUMBERED = /^\s*(\d+[.)]|\([a-z]\)|\([iv]+\)|[-•])\s+/i;
/** A line of figures in columns — must be kept exactly, never re-flowed.
 *  The run of spaces must be INTERNAL: matching leading indentation instead
 *  turned every wrapped continuation line into a monospaced fragment. */
const COLUMNAR = /\S\s{2,}\S/;

export async function buildMockPaperPdf(input: { title: string; text: string; footer?: string; attempt?: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const c: Ctx = {
    pdf, page: pdf.addPage([PAGE_W, PAGE_H]), y: PAGE_H - TOP, pageNo: 1,
    body: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    mono: await pdf.embedFont(StandardFonts.Courier),
    title: input.title,
    attempt: (input.attempt || "SEPTEMBER 2026 EXAM").toUpperCase(),
  };
  // The first page is created before the context exists, so it is stamped here.
  stamp(c, c.attempt);

  // Fold an indented continuation back onto the line it belongs to, BEFORE
  // anything is classified. The writer wraps a numbered instruction across two
  // or three lines and indents the rest; each of those was arriving as its own
  // paragraph, so an instruction came out in pieces down the page.
  const src: string[] = [];
  for (const raw of String(input.text ?? "").split("\n")) {
    const isContinuation =
      /^\s{2,}\S/.test(raw) &&                  // indented
      !/\S\s{2,}\S/.test(raw.trim()) &&        // not a row of figures
      src.length > 0 && src[src.length - 1].trim() !== "";
    if (isContinuation) src[src.length - 1] += " " + raw.trim();
    else src.push(raw);
  }
  let inHeader = true;

  // Gather consecutive prose lines, then set them as one justified paragraph.
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const joined = para.join(" ");
    const m = joined.match(MARKS_TAIL);
    const ws = words(m ? joined.replace(MARKS_TAIL, "") : joined);
    const lines = layout(ws, c.body, BODY, WIDTH);
    lines.forEach((ln, i) => {
      need(c, LEAD);
      const last = i === lines.length - 1;
      drawLine(c, ln, LEFT, WIDTH, c.body, BODY, !last);
      if (m && last) {
        const tail = winAnsi(`(${m[1]} Marks)`);
        c.page.drawText(tail, { x: PAGE_W - RIGHT - c.bold.widthOfTextAtSize(tail, 9.5), y: c.y, size: 9.5, font: c.bold });
      }
      c.y -= LEAD;
    });
    c.y -= 5;
    para = [];
  };

  const centre = (t: string, size: number, font: PDFFont, gapAfter: number) => {
    need(c, size + gapAfter);
    const s = winAnsi(t);
    c.page.drawText(s, { x: (PAGE_W - font.widthOfTextAtSize(s, size)) / 2, y: c.y, size, font });
    c.y -= size + gapAfter;
  };

  for (const raw of src) {
    const line = raw.replace(/\s+$/, "");
    const t = line.trim();

    if (!t) { flush(); continue; }

    if (inHeader && CENTRED_HEAD.test(t)) {
      flush();
      const big = /^(MOCK EXAMINATION|PAPER \d)/i.test(t);
      centre(t, big ? 15 : 11, c.bold, big ? 6 : 4);
      continue;
    }

    const startsFlush = !/^\s/.test(raw);

    if (startsFlush && t.length < 70 && PART_HEAD.test(t)) {
      flush(); inHeader = false;
      c.y -= 8;
      centre(t, 13, c.bold, 5);
      c.page.drawLine({ start: { x: LEFT + 110, y: c.y + 4 }, end: { x: PAGE_W - RIGHT - 110, y: c.y + 4 }, thickness: 0.8, color: rgb(0.15, 0.15, 0.15) });
      c.y -= 8;
      continue;
    }

    // The bracketed sub-lines under a part heading are centred too.
    if (!inHeader && /^\(.*\)$/.test(t) && t.length < 90) {
      flush();
      centre(t, 9.5, c.italic, 3);
      continue;
    }

    if (startsFlush && SECTION_HEAD.test(t)) {
      flush(); inHeader = false;
      c.y -= 7;
      need(c, 24);
      const m = t.match(MARKS_TAIL);
      const head = winAnsi(m ? t.replace(MARKS_TAIL, "") : t);
      c.page.drawText(head, { x: LEFT, y: c.y, size: 11.5, font: c.bold });
      if (m) {
        const tail = winAnsi(`[${m[1]} Marks]`);
        c.page.drawText(tail, { x: PAGE_W - RIGHT - c.bold.widthOfTextAtSize(tail, 10), y: c.y, size: 10, font: c.bold });
      }
      c.y -= 18;
      continue;
    }

    inHeader = false;

    // A line of figures in columns keeps its own shape, in a fixed-width face —
    // re-flowing it would destroy the alignment it depends on. But a line whose
    // wide gap is only there to push "(2 Marks)" to the right is prose, and was
    // being set in Courier in the middle of a sentence.
    if (COLUMNAR.test(line) && !MARKS_TAIL.test(line)) {
      flush();
      need(c, 13);
      c.page.drawText(winAnsi(line).slice(0, 96), { x: LEFT, y: c.y, size: 9, font: c.mono });
      c.y -= 13;
      continue;
    }

    // A numbered item or an option starts its own paragraph, hanging-indented.
    if (NUMBERED.test(line)) {
      flush();
      const m = line.trim().match(MARKS_TAIL);
      const body = m ? line.trim().replace(MARKS_TAIL, "") : line.trim();
      const label = body.match(NUMBERED)?.[0].trim() ?? "";
      const rest = body.slice(label.length).trim();
      const hang = Math.max(18, c.body.widthOfTextAtSize(label + " ", BODY));
      const lines = layout(words(rest), c.body, BODY, WIDTH - hang);
      lines.forEach((ln, i) => {
        need(c, LEAD);
        if (i === 0) c.page.drawText(winAnsi(label), { x: LEFT, y: c.y, size: BODY, font: c.body });
        drawLine(c, ln, LEFT + hang, WIDTH - hang, c.body, BODY, i < lines.length - 1);
        if (m && i === lines.length - 1) {
          const tail = winAnsi(`(${m[1]} Marks)`);
          c.page.drawText(tail, { x: PAGE_W - RIGHT - c.bold.widthOfTextAtSize(tail, 9.5), y: c.y, size: 9.5, font: c.bold });
        }
        c.y -= LEAD;
      });
      c.y -= 3;
      continue;
    }

    para.push(t);
  }
  flush();

  foot(c);
  if (input.footer) {
    c.page.drawText(winAnsi(input.footer), { x: LEFT, y: BOTTOM - 26, size: 8, font: c.italic, color: rgb(0.45, 0.45, 0.45) });
  }
  return pdf.save();
}
