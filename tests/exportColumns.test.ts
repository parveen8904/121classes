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

const FILES = [
  { path: ["app", "admin", "orders", "export", "route.ts"], name: "sales export", rows: 3 },
  { path: ["app", "admin", "warehouse", "export", "route.ts"], name: "warehouse export", rows: 1 },
];

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

let fails = 0;

for (const f of FILES) {
  const src = readFileSync(join(import.meta.dirname, "..", ...f.path), "utf8")
    .replace(/\/\/[^\n]*/g, ""); // comments hold commas too

  // Both files name their header the same way; if one is restructured the guard
  // must fail loudly rather than quietly checking nothing.
  const header = src.match(/(?:const rows|const out) = \[\[(.*?)\]\.join\(","\)\];/s);
  if (!header) {
    fails++;
    console.log(`FAIL  ${f.name}: could not find the header row — has the file been restructured?`);
    continue;
  }
  const want = cells(header[1]);

  const pushes = [...src.matchAll(/(?:rows|out)\.push\(\[(.*?)\]\.join\(","\)\);/gs)];
  if (pushes.length < f.rows) {
    fails++;
    console.log(`FAIL  ${f.name}: expected at least ${f.rows} row builder(s), found ${pushes.length}`);
    continue;
  }

  let bad = 0;
  pushes.forEach((m, i) => {
    const got = cells(m[1]);
    if (got !== want) {
      bad++;
      console.log(`FAIL  ${f.name} row ${i + 1} has ${got} columns, the header has ${want}`);
    }
  });
  fails += bad;
  if (bad === 0) console.log(`  ${f.name}: ${pushes.length} row shape(s), all ${want} columns wide`);
}

console.log(fails === 0 ? "PASS  every download row is exactly as wide as its header" : "");
process.exit(fails === 0 ? 0 : 1);
