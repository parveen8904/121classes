// The vault: read the document once, then ask what it is.
//
// His design, 2 September 2026: "there should be one page to upload any
// document. It can be invoice, it can be any bank statement, any credit card,
// any other thing. When we upload you have to convert it into Excel format or
// the format that is readable by you. Then in the same page you will ask what
// is this document... Once you have saved the document, then you will go to
// that particular page of the bank statement or invoice where it's already
// available in the readable form, then you will generate the entries."
//
// He is right, and it is the answer to a week of failures on one PDF. The
// statement uploader did three jobs on one press — get the file, understand the
// file, book what is in it — so a file it could not read left NOTHING behind:
// no record, no partial result, nothing to look at. The same statement was read
// three times in an evening and thrown away three times.
//
//   node --experimental-strip-types tests/vaultTwoSteps.test.ts

import { rowsToCsv } from "../lib/rowsCsv.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};
const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── step one: the reading is kept, whatever happens ──────────────────────
const actions = read("app/admin/zoho/actions.ts");
const upload = actions.slice(actions.indexOf("export async function vaultUploadAction"),
                             actions.indexOf("export async function vaultRereadAction"));
check("the document is recorded BEFORE it is read",
  upload.indexOf('.from("zoho_vault_docs").insert') < upload.indexOf("readDocument"),
  "a file that cannot be read must still be in the vault — that is the whole complaint");
check("what was read is stored beside it",
  /rows_json: r\.rows\.length \? r\.rows : null/.test(upload));
check("and so is the reason it could not be",
  /read_note: r\.ok \? null : \(r\.note/.test(upload),
  "a failure you can see beats one that vanished");
check("a reader that throws still leaves the document filed",
  /catch \(e\) \{[\s\S]{0,200}read_note: e instanceof Error/.test(upload));
check("which reader got it is recorded",
  /read_how: r\.ok \? r\.how : null/.test(upload),
  "a figure read off a drawn page deserves a second look; one parsed from a table does not");

// ── step two: what it is, asked with the reading on screen ───────────────
const page = read("app/admin/zoho/vault/page.tsx");
check("the upload box takes anything",
  /accept="\.csv,\.txt,\.xls,\.xlsx,\.pdf,image\/\*"/.test(page));
check("the reading is shown back before the question is asked",
  page.indexOf("focus.rows_json") < page.indexOf('name="kind"'),
  "the point of two steps is answering with the document on the screen");
check("the question offers the four answers he named",
  /value="bank_statement"/.test(page) && /value="credit_card"/.test(page) &&
  /value="invoice"/.test(page) && /value="other"/.test(page));
check("which account is chosen from the real list of banks and cards",
  /list="vault-accounts"/.test(page) && /bankChoices\.map/.test(page));
check("a document that could not be read says so, and can be tried again",
  /Nothing could be read from it/.test(page) && /vaultRereadAction/.test(page));
check("the reading can be downloaded as a spreadsheet",
  /vault\/\$\{focus\.id\}\/csv/.test(page),
  "‘convert it into Excel format’ — a bad read becomes a file you can check, not an argument");

// ── and the second step never re-reads the file ──────────────────────────
const classify = actions.slice(actions.indexOf("export async function vaultClassifyAction"));
check("a statement is filed from the STORED table",
  /const rows = \(d\?\.rows_json \?\? null\) as string\[\]\[\] \| null/.test(classify) &&
  /ingestRows\(account, rows!/.test(classify),
  "the original file is not read again — that is what made the same PDF fail three times");
check("nothing read means nothing filed, and it says so",
  /Nothing was read from this document, so there are no lines to file/.test(classify));
check("a bank or card must name its account before anything is filed",
  /Choose which bank or card it belongs to/.test(classify));
check("filing takes you to the page the lines landed on",
  /redirect\(`\/admin\/zoho\/statements\?scan=/.test(classify),
  "his second step: go to that particular page, where it is already readable");
check("the document remembers what it became",
  /used_table: "bank_statements", used_id: r\.statementId/.test(classify));

// ── one door, not two ────────────────────────────────────────────────────
const statements = read("app/admin/zoho/statements/page.tsx");
check("the statements page no longer has an uploader of its own",
  !/<StatementUpload/.test(statements),
  "a second uploader would put the old one-press behaviour back beside the new one");
check("it points at the vault instead", /Statements come in through the vault/.test(statements));

// ── the reader ladder is shared, and says which rung it used ─────────────
const docRead = read("lib/docRead.ts");
for (const how of ["table", "text", "picture", "drawn"]) {
  check(`"${how}" is a recorded way of reading`, new RegExp(`"${how}"`).test(docRead));
}
check("a spreadsheet or CSV is taken as a table, with no model at all",
  /how: "table"/.test(docRead));
check("a photograph goes straight to the reader that can see it",
  /IMAGE\.test\(lower\)/.test(docRead));
check("an unrecognised extension is tried rather than refused",
  /Try it as a picture anyway rather than refusing a file for its name/.test(docRead));

// ── the CSV itself ───────────────────────────────────────────────────────
check("a comma inside a cell is quoted",
  rowsToCsv([["a,b", "c"]]) === '"a,b",c', rowsToCsv([["a,b", "c"]]));
check("a quote inside a cell is doubled",
  rowsToCsv([['he said "no"']]) === '"he said ""no"""', rowsToCsv([['he said "no"']]));
check("a newline inside a cell is quoted",
  rowsToCsv([["two\nlines"]]) === '"two\nlines"');
check("an ordinary row is left alone",
  rowsToCsv([["01-08-2026", "SWIGGY", "842.50"]]) === "01-08-2026,SWIGGY,842.50");
check("rows are one per line",
  rowsToCsv([["a"], ["b"]]) === "a\nb");

console.log(fails === 0 ? "ok — the vault, in two steps" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
