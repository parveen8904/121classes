// A PDF'S TABLE, PUT BACK TOGETHER FROM WHERE THE WORDS SIT.
//
// His question, 2 September 2026: "I tried uploading the PDF for my credit
// cards as well as my bank statements which were not excel sheet and you did
// not properly understand it. Why are you unable to read it?"
//
// Two reasons, and this file is the second one.
//
// The first was that the PDFs were password-protected and we reported that as
// "scanned images?" — fixed in lib/pdf.ts.
//
// The second is that a PDF statement was handed to the AI as one long string,
// while an Excel statement went through rowsToLines(): real code, with header
// detection tuned against his own Axis exports, the reference-column priority
// the accounts desk asked for, and Dr/Cr handling. Flattening a table to prose
// throws away the one thing that makes it a table — WHERE each number sits —
// and then asks a model to guess it back. No wonder the answers were poor.
//
// A PDF does not actually lose that. Every text fragment carries an x and a y.
// Fragments sharing a y are a row; a gap along x is a column boundary. Rebuild
// those and a PDF statement can go through exactly the same parser as the
// spreadsheet, with no model involved at all.
//
// Nothing here imports anything, so the rules can be proved in a test.

export type TextItem = { str: string; x: number; y: number; width?: number; height?: number };

/**
 * How far apart two fragments may sit vertically and still be the same row.
 *
 * Taken from the text itself rather than fixed: a statement set in 7pt and one
 * set in 11pt do not have the same idea of "the same line", and a fixed
 * tolerance merges two rows on the small one or splits one on the large.
 */
function rowTolerance(items: TextItem[]): number {
  const heights = items.map((i) => i.height ?? 0).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 8;
  return Math.max(1.5, median * 0.6);
}

/**
 * How wide a horizontal gap has to be before it separates two CELLS rather
 * than two words. A space between words in 8pt type is about 2pt; a column
 * gutter is many times that. Derived from the median fragment height so it
 * scales with the type size, with a floor for very tight tables.
 */
function colGap(items: TextItem[]): number {
  const heights = items.map((i) => i.height ?? 0).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 8;
  return Math.max(3.5, median * 0.9);
}

type Cell = { text: string; x: number; right: number };

/** Fragments on one line, merged into cells, each keeping where it sits. */
function lineToCells(row: TextItem[], gap: number): Cell[] {
  const ordered = [...row].sort((a, b) => a.x - b.x);
  const cells: Cell[] = [];
  let text = "";
  let start = 0;
  let endOfPrev: number | null = null;
  for (const it of ordered) {
    const t = String(it.str).trim();
    if (!t) continue;
    if (endOfPrev !== null && it.x - endOfPrev > gap) {
      cells.push({ text: text.trim(), x: start, right: endOfPrev });
      text = t; start = it.x;
    } else {
      if (!text) start = it.x;
      text = text ? `${text} ${t}` : t;
    }
    endOfPrev = it.x + (it.width ?? 0);
  }
  if (text.trim()) cells.push({ text: text.trim(), x: start, right: endOfPrev ?? start });
  return cells;
}

/**
 * AN EMPTY CELL IS A CELL, AND LEAVING IT OUT BOOKS THE WRONG THING.
 *
 * The first version of this returned each row as however many cells it
 * happened to contain. On a statement row with money going OUT, the deposit
 * column is blank — so the row came back one cell short and the closing
 * balance slid left into the deposit position. A withdrawal would have been
 * filed as a deposit, silently, with a plausible-looking figure.
 *
 * So the columns are worked out once for the whole document and every row is
 * laid into them, blanks included. Columns are found by OVERLAP rather than by
 * start position, because amount columns are right-aligned: "842.50" and
 * "18,959.20" start in different places and end in the same one.
 */
function columnBands(rows: Cell[][]): { x: number; right: number }[] {
  // A HEADING DOES NOT DEFINE A COLUMN.
  //
  // "Axis Bank - Statement of Account" runs across the page as ONE cell, and
  // letting it into the calculation welded the date and particulars columns
  // together — every row then came back with the date glued to the narration.
  // A line holding a single cell is a title, an address block or a footer; it
  // is never the table. Only lines with two or more cells shape the columns.
  const tabular = rows.filter((r) => r.length > 1);
  const spans = (tabular.length ? tabular : rows).flat()
    .map((c) => ({ x: c.x, right: Math.max(c.right, c.x + 1) }))
    .sort((a, b) => a.x - b.x);
  const bands: { x: number; right: number }[] = [];
  for (const sp of spans) {
    const last = bands[bands.length - 1];
    // Touching or overlapping spans are the same column. A one-point tolerance
    // absorbs the rounding in a PDF's own coordinates.
    if (last && sp.x <= last.right + 1) last.right = Math.max(last.right, sp.right);
    else bands.push({ ...sp });
  }
  return bands;
}

/** One page of positioned fragments → rows of cells, top to bottom, left to right. */
export function itemsToRows(items: TextItem[]): string[][] {
  return pagesToRows([items]);
}

/** Every page's rows, in order, as one table — a statement runs across pages. */
export function pagesToRows(pages: TextItem[][]): string[][] {
  const all = pages.flat().filter((i) => String(i.str ?? "").trim().length > 0);
  if (!all.length) return [];
  const tol = rowTolerance(all);
  const gap = colGap(all);

  const lines: Cell[][] = [];
  for (const page of pages) {
    const kept = page.filter((i) => String(i.str ?? "").trim().length > 0);
    if (!kept.length) continue;
    // PDF y grows UPWARDS, so a page reads from the largest y to the smallest.
    const byY = [...kept].sort((a, b) => b.y - a.y || a.x - b.x);
    let current: TextItem[] = [];
    let anchor = byY[0].y;
    for (const it of byY) {
      if (Math.abs(it.y - anchor) <= tol) current.push(it);
      else { if (current.length) lines.push(lineToCells(current, gap)); current = [it]; anchor = it.y; }
    }
    if (current.length) lines.push(lineToCells(current, gap));
  }

  const bands = columnBands(lines);
  // A page of prose — a covering letter, a terms page — produces one band and
  // nothing table-like. Returning it as single-cell rows is right: the parser
  // downstream will simply not find a header in it.
  if (bands.length <= 1) return lines.map((l) => l.map((c) => c.text)).filter((r) => r.length > 0);

  const overlap = (c: Cell, b: { x: number; right: number }) =>
    Math.max(0, Math.min(c.right, b.right) - Math.max(c.x, b.x));

  return lines.map((cells) => {
    const out = new Array<string>(bands.length).fill("");
    for (const c of cells) {
      let best = 0, bestOv = -1;
      for (let i = 0; i < bands.length; i++) {
        const ov = overlap(c, bands[i]);
        if (ov > bestOv) { bestOv = ov; best = i; }
      }
      out[best] = out[best] ? `${out[best]} ${c.text}` : c.text;
    }
    return out;
  }).filter((r) => r.some((c) => c));
}
