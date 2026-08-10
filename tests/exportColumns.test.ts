import { readFileSync } from "node:fs";
import { join } from "node:path";

// A SPREADSHEET WITH A SHORT ROW IS WORSE THAN NO SPREADSHEET.
//
// The sales download builds its rows by hand, one esc(...) per column, in three
// separate loops — website orders, book orders, supporter sales. Add a column
// to the header and update two loops out of three, and the file still opens:
// every value on the forgotten rows is simply shifted one place left, so phone
// numbers appear under Email and the money lands in the wrong column. Nothing
// errors. Somebody reconciles against it and the numbers are wrong.
//
// So: every row must be exactly as wide as the header.

const file = join(import.meta.dirname, "..", "app", "admin", "orders", "export", "route.ts");
const src = readFileSync(file, "utf8").replace(/\/\/[^\n]*/g, ""); // comments hold commas too

/** Commas at bracket depth zero — one per cell. */
function cells(body: string): number {
  let depth = 0, n = 1;
  for (const ch of body) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) n++;
  }
  return body.trimEnd().endsWith(",") ? n - 1 : n;
}

const header = src.match(/const rows = \[\[(.*?)\]\.join\(","\)\];/s);
if (!header) {
  console.log("FAIL  export: could not find the header row — has the file been restructured?");
  process.exit(1);
}
const want = cells(header[1]);

const pushes = [...src.matchAll(/rows\.push\(\[(.*?)\]\.join\(","\)\);/gs)];
if (pushes.length < 3) {
  console.log(`FAIL  export: expected at least 3 row builders (orders, books, supporter sales), found ${pushes.length}`);
  process.exit(1);
}

let bad = 0;
pushes.forEach((m, i) => {
  const got = cells(m[1]);
  if (got !== want) {
    bad++;
    console.log(`FAIL  export row ${i + 1} has ${got} columns, the header has ${want}`);
  }
});

console.log(bad === 0 ? `PASS  sales export: ${pushes.length} row shapes, all ${want} columns wide` : "");
process.exit(bad === 0 ? 0 : 1);
