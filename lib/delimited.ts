// READING WHAT A COURIER ACTUALLY SENDS.
//
// A manifest arrives as "a CSV", which in practice means commas or semicolons
// or tabs, some fields quoted and some not, a byte-order mark from Excel, and
// Windows line endings. A parser that only handles the tidy case sends a packer
// back to typing forty tracking numbers by hand.
//
// Kept out of the server action so it can be tested as itself.

/**
 * A CSV, near enough.
 *
 * Couriers send commas, semicolons and tabs, quote some fields and not others,
 * and end lines however their system feels like. This handles quotes and the
 * three separators; anything stranger is the office's cue to save it again as
 * a plain CSV, which is a sentence the screen says out loud.
 */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/)[0] ?? "";
  const sep = firstLine.includes("\t") ? "\t" : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === sep) { row.push(cur); cur = ""; continue; }
    if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (c === "\r") continue;
    cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}
