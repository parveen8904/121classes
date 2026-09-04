// The compliance register must show GST number and trade name on the row.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const src = readFileSync("app/admin/supporters/page.tsx", "utf8");

check("both fields are read from the profile",
  /\.select\("id, full_name, business_name, trade_name, gstin,/.test(src),
  "a column cannot show what the query never asked for");
check("the table has both headers",
  /<th style=\{TH\}>GST number<\/th><th style=\{TH\}>Trade name<\/th>/.test(src));
check("the GSTIN is printed whole, not truncated",
  /\{s\(x\.gstin\)\.trim\(\) \|\| <span className="muted">No<\/span>\}/.test(src),
  "a GSTIN read off a shortened column is checked against the wrong party");
check("a missing GSTIN says No, not nothing",
  /gstin\)\.trim\(\) \|\| <span className="muted">No<\/span>/.test(src));
check("the trade name falls back to the profile name",
  /s\(x\.trade_name\)\.trim\(\) \|\| s\(x\.business_name\)\.trim\(\) \|\| <span className="muted">No<\/span>/.test(src),
  "one box writes both columns; reading one would answer No for most of the register");
check("a disagreement between the two is shown, not hidden",
  /profile name: \{s\(x\.business_name\)\}/.test(src));

// Every row must have exactly as many cells as the head has columns.
const block = src.slice(src.indexOf("Every supporter&apos;s website"));
const table = block.slice(0, block.indexOf("</table>"));
const th = (table.match(/<th style=\{TH\}>/g) ?? []).length;
const td = (table.match(/\n {20}<td style=/g) ?? []).length;
check("the row has a cell for every header", th === td, `${th} headers, ${td} cells`);

console.log(fails ? `${fails} failed` : "ok — the register shows GST number and trade name");
process.exit(fails ? 1 : 0);
