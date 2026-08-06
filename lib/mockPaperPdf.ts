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
  // TILED, corner to corner.
  //
  // One mark across the middle is removed by cropping the top third of a
  // screenshot. Repeated the whole way down the page it cannot be: whichever
  // part somebody takes, it carries the name. Fainter than a single mark would
  // be, because six of them at that strength would fight with the questions.
  const A = Math.PI / 4;
  const along = { x: Math.cos(A), y: Math.sin(A) };
  const perp = { x: Math.sin(A), y: -Math.cos(A) };

  const label = `CA PARVEEN SHARMA  ·  ${attempt}`;
  const size = 20;
  const w = c.bold.widthOfTextAtSize(winAnsi(label), size);

  // Rows run ACROSS the diagonal; each row is repeated ALONG it. The span is
  // generous on both axes so the marks reach past all four corners rather than
  // stopping short and leaving a clean edge to crop to.
  const ROW_GAP = 92;
  const COL_GAP = w + 80;
  const rows = Math.ceil(1100 / ROW_GAP);
  const cols = Math.ceil(1300 / COL_GAP);

  for (let r = -Math.ceil(rows / 2); r <= Math.ceil(rows / 2); r++) {
    for (let k = -Math.ceil(cols / 2); k <= Math.ceil(cols / 2); k++) {
      const offAcross = r * ROW_GAP;
      const offAlong = k * COL_GAP + (r % 2 ? COL_GAP / 2 : 0); // brick-stagger
      const midX = PAGE_W / 2 + perp.x * offAcross + along.x * offAlong;
      const midY = PAGE_H / 2 + perp.y * offAcross + along.y * offAlong;
      const x = midX - (w / 2) * along.x;
      const y = midY - (w / 2) * along.y;
      // Skip anything that cannot put ink on the page at all.
      if (x > PAGE_W + 40 || y > PAGE_H + 40 || x + w < -160 || y + w < -160) continue;
      c.page.drawText(winAnsi(label), {
        x, y, size, font: c.bold,
        rotate: degrees(45),
        color: rgb(0.55, 0.6, 0.62),
        opacity: 0.09,
      });
    }
  }
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

const MARKS_TAIL = /\s*[[(]\s*(\d+(?:\s*(?:\+|and)\s*\d+)?)\s*(?:marks?)?\s*[\])]\s*$/i;
const CENTRED_HEAD = /^(MOCK EXAMINATION|INTERMEDIATE EXAMINATION|FINAL EXAMINATION|PAPER \d|Time Allowed|Maximum Marks)/i;
const PART_HEAD = /^PART\s+(I|II|1|2)\b/i;
const SECTION_HEAD = /^(INSTRUCTIONS TO CANDIDATES|CASE SCENARIO\s*\d*|QUESTION\s+\d+|Q\.?\s*\d+\b)/i;
const NUMBERED = /^\s*(\d+[.)]|\([a-z]\)|\([iv]+\)|[-•])\s+/i;
/** How many INTERNAL runs of 2+ spaces a line has — i.e. how many column gaps.
 *  Leading indentation must not count: matching that turned every wrapped
 *  continuation into a monospaced fragment. */
function columnGaps(line: string): number {
  return (line.replace(MARKS_TAIL, "").match(/\S {2,}(?=\S)/g) ?? []).length;
}

/**
 * Which lines are really TABLE, decided over the whole paper rather than one
 * line at a time.
 *
 * A single wide gap is not a table. "(i)  Depreciation charged in books…" has
 * one, and so does "Time Allowed: 3 Hours        Maximum Marks: 100", and so
 * does every MCQ option padded out to a right-hand "[2]" — all of them prose,
 * all of them set in Courier in the middle of Times, which is why a quarter of
 * the paper came out in the wrong face.
 *
 * A real table row has TWO or more gaps (three or more columns). A row with one
 * gap counts only when it sits directly against such a row — that keeps the
 * two-column rows inside a table aligned without dragging sentences in.
 */
function tableLines(lines: string[]): boolean[] {
  const gaps = lines.map(columnGaps);
  const blank = lines.map((l) => !l.trim());
  const out = lines.map((_, i) => gaps[i] >= 2 && !blank[i]);

  // A RUN of aligned lines is a table even at one gap each — that is what a
  // two-column list of figures looks like ("Lease term:    5 years"). One or
  // two such lines on their own is prose that happens to contain a wide space.
  let i = 0;
  while (i < lines.length) {
    if (blank[i] || gaps[i] < 1) { i++; continue; }
    let j = i, aligned = 0, last = i;
    while (j < lines.length && !blank[j]) {
      if (gaps[j] >= 1) { aligned++; last = j; j++; continue; }
      // A row's label often runs over two lines, and the overflow carries no
      // gap of its own — "Cost of goods sold (based on estimated annual" and
      // then "gross profit rate of 30%):        Rs. 2,52,00,000". Breaking the
      // run there left every such table set as a paragraph of prose.
      if (j + 1 < lines.length && !blank[j + 1] && gaps[j + 1] >= 1) { j++; continue; }
      break;
    }
    if (aligned >= 3) for (let k = i; k <= last; k++) out[k] = true;
    i = Math.max(j, i + 1);
  }
  // A table has a HEAD above its figures: the column names ("SHL      WLL"),
  // the units under them ("Rs.      Rs."), and often a bare sub-heading such as
  // EQUITY AND LIABILITIES. None of those has two gaps, so all three were being
  // read as prose and joined into the sentence above — the balance sheet arrived
  // with "SHL WLL Rs. Rs. EQUITY AND LIABILITIES" running across one line.
  const isLabel = (l: string) => l.trim().length <= 45 && !/[.:;?]$/.test(l.trim());
  for (let k = 0; k < lines.length; k++) {
    if (!out[k]) continue;
    for (let a = k - 1; a >= 0 && !blank[a] && !out[a] && (gaps[a] >= 1 || isLabel(lines[a])); a--) out[a] = true;
    // Downward only where the line is itself aligned: a bare label BELOW a table
    // is far more often the next heading than part of what came before.
    for (let b = k + 1; b < lines.length && !blank[b] && !out[b] && gaps[b] >= 1; b++) out[b] = true;
  }

  // A wrapped label carrying no gaps of its own, sandwiched inside a table,
  // belongs to that table — otherwise a row's first line came out in Times
  // while its figures were in Courier.
  for (let k = 1; k < lines.length - 1; k++) {
    if (!out[k] && !blank[k] && out[k - 1] && out[k + 1]) out[k] = true;
  }
  return out;
}

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
    // The marks are padded out to the right margin, so they leave a wide gap of
    // their own. Counting it made "…the hardware it runs on.        [4]" look
    // like a row of figures, and the sentence stayed broken in two.
    const naked = raw.replace(MARKS_TAIL, "").trim();
    const isContinuation =
      /^\s{2,}\S/.test(raw) &&                  // indented
      !/\S\s{2,}\S/.test(naked) &&             // not a row of figures
      !NUMBERED.test(naked) &&                 // not the NEXT option or item
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

  // Decided once, over the whole document — a table is a BLOCK, not a line.
  const isTable = tableLines(src.map((r) => r.replace(/\s+$/, "")));

  for (const [idx, raw] of src.entries()) {
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

    // A sub-part marker standing alone on its line — "(a)" above EITHER — is a
    // heading for what follows, not a note about what came before, so it sits
    // flush left in bold instead of centred in italics.
    if (/^\([a-d]\)$/.test(t)) {
      flush();
      need(c, 18);
      c.page.drawText(t, { x: LEFT, y: c.y, size: 11, font: c.bold });
      c.y -= 17;
      continue;
    }

    // The bracketed sub-lines under a part heading are centred too — but an
    // option such as "(a) Rs. 3,00,000 (over useful life of 8 years)" also
    // opens and closes on a bracket, and three of Q13's four answers came out
    // centred in italics while the fourth sat flush left.
    if (!inHeader && /^\(.*\)$/.test(t) && t.length < 90 && !NUMBERED.test(t)) {
      flush();
      centre(t, 9.5, c.italic, 3);
      continue;
    }

    if (startsFlush && SECTION_HEAD.test(t)) {
      flush(); inHeader = false;
      c.y -= 7;
      need(c, 24);
      const m = t.match(MARKS_TAIL);
      // A question stem is often a full sentence, so the heading has to wrap
      // like any other text — drawn in one piece it simply ran off the page.
      const headLines = layout(words(m ? t.replace(MARKS_TAIL, "") : t), c.bold, 11.5, m ? WIDTH - 62 : WIDTH);
      headLines.forEach((ln, i) => {
        need(c, 16);
        c.page.drawText(ln.join(" "), { x: LEFT, y: c.y, size: 11.5, font: c.bold });
        if (m && i === 0) {
          const tail = winAnsi(`[${m[1]} Marks]`);
          c.page.drawText(tail, { x: PAGE_W - RIGHT - c.bold.widthOfTextAtSize(tail, 10), y: c.y, size: 10, font: c.bold });
        }
        if (i < headLines.length - 1) c.y -= 15;
      });
      c.y -= 18;
      continue;
    }

    inHeader = false;

    // A genuine table keeps its own shape, in a fixed-width face — re-flowing it
    // would destroy the alignment it depends on. Everything else is prose and
    // stays in Times, however wide a gap it happens to contain.
    if (isTable[idx]) {
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
