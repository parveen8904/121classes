// Reading a statement that arrived as a PDF.
//
// His report, 2 September 2026: "I tried uploading the PDF for my credit cards
// as well as my bank statements which were not excel sheet and you did not
// properly understand it. Can you please check it? Why are you unable to read
// it?"
//
// Three uploads failed that afternoon — the Axis 8882 card, and the NRE and NRO
// accounts — every one saying "could not read text from this PDF (scanned
// images?)". Two separate faults, and this file holds both fixes.
//
//   node --experimental-strip-types tests/pdfStatement.test.ts

import { pagesToRows, itemsToRows, type TextItem } from "../lib/pdfTable.ts";
import { rowsToLines } from "../lib/bankStatementRows.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

/** A fragment as pdf.js hands it over: text, and where it sits. */
const at = (str: string, x: number, y: number, width = str.length * 3.6, height = 7): TextItem =>
  ({ str, x, y, width, height });

// A statement laid out the way a bank draws one: a banner, an account block,
// a header row, then rows where the empty column is genuinely empty.
const COLS = { date: 40, narr: 105, wdr: 300, dep: 375, bal: 450, ref: 520 };
const page: TextItem[] = [
  at("Axis Bank - Statement of Account", 40, 810),
  at("Account No 923020019087117   Period 01-08-2026 to 31-08-2026", 40, 798),
  at("Tran Date", COLS.date, 780), at("Transaction Particulars", COLS.narr, 780),
  at("Withdrawal Amt.", COLS.wdr, 780), at("Deposit Amt.", COLS.dep, 780),
  at("Closing Balance", COLS.bal, 780), at("Internal Reference Number", COLS.ref, 780),

  at("01-08-2026", COLS.date, 764), at("UPI/P2A/102327/SWIGGY BANGALORE", COLS.narr, 764),
  at("842.50", COLS.wdr, 764), at("120157.50", COLS.bal, 764), at("AXI9911", COLS.ref, 764),

  at("03-08-2026", COLS.date, 748), at("NEFT/UTIBR6202/OM ART PRESS", COLS.narr, 748),
  at("18959.20", COLS.wdr, 748), at("101198.30", COLS.bal, 748), at("AXI9912", COLS.ref, 748),

  at("05-08-2026", COLS.date, 732), at("Razorpay Software Pvt  Ltd  Fu", COLS.narr, 732),
  at("17772.00", COLS.dep, 732), at("118970.30", COLS.bal, 732), at("AXI9913", COLS.ref, 732),
];

const rows = itemsToRows(page);

// ── AN EMPTY CELL IS A CELL ────────────────────────────────────────────────
//
// The first version returned each row as however many cells it happened to
// contain. On a row where money went OUT, the deposit column is blank, so the
// row came back one short and the closing balance slid left into the deposit
// position — a withdrawal filed as a deposit, silently, with a plausible
// figure. Every row must be the same width as the header.
{
  const header = rows.find((r) => r.includes("Tran Date"));
  check("the header row is found whole", !!header && header.length >= 6, JSON.stringify(header));
  const body = rows.filter((r) => /^\d{2}-\d{2}-\d{4}$/.test(r[0] ?? ""));
  check("three transaction rows", body.length === 3, String(body.length));
  check("every row is as wide as the header",
    body.every((r) => r.length === header!.length),
    body.map((r) => r.length).join(","));
  check("a blank deposit column stays blank, in its own place",
    body[0][3] === "" && body[0][2] === "842.50",
    JSON.stringify(body[0]));
  check("and the closing balance does not slide into it",
    body[0][4] === "120157.50",
    "this is the bug that would have booked a withdrawal as a deposit");
  check("the credit row puts its money in the deposit column",
    body[2][2] === "" && body[2][3] === "17772.00", JSON.stringify(body[2]));
}

// ── A BANNER IS NOT A COLUMN ───────────────────────────────────────────────
//
// "Axis Bank - Statement of Account" runs across the page as one cell. Letting
// it shape the columns welded the date and particulars together, and every row
// came back with the date glued to the narration.
{
  const body = rows.filter((r) => /^\d{2}-\d{2}-\d{4}$/.test(r[0] ?? ""));
  check("the date stands alone in its own column",
    body.every((r) => /^\d{2}-\d{2}-\d{4}$/.test(r[0])),
    JSON.stringify(body[0]));
  check("the banner did not take the narration with it",
    body[0][1] === "UPI/P2A/102327/SWIGGY BANGALORE", JSON.stringify(body[0][1]));
}

// ── AND THE WHOLE THING GOES THROUGH THE SAME PARSER AS EXCEL ─────────────
{
  const { lines, note } = rowsToLines(rows);
  check("a PDF statement parses with no model involved", lines.length === 3, note);
  check("dates come out as dates", lines[0]?.date === "2026-08-01", lines[0]?.date);
  check("money out is a debit", lines[0]?.debit === 842.5 && lines[0]?.credit === 0, JSON.stringify(lines[0]));
  check("money in is a credit", lines[2]?.credit === 17772 && lines[2]?.debit === 0, JSON.stringify(lines[2]));
  check("the running balance survives", lines[1]?.balance === 101198.3, String(lines[1]?.balance));
  check("the internal reference is picked up, as the desk asked",
    lines[0]?.ref === "AXI9911", lines[0]?.ref);
  check("the narration is the particulars and nothing else",
    lines[1]?.narration === "NEFT/UTIBR6202/OM ART PRESS", lines[1]?.narration);
}

// ── pages run together, because a statement does ──────────────────────────
{
  const two = pagesToRows([page, page]);
  check("a second page's rows follow the first's",
    two.filter((r) => /^\d{2}-\d{2}-\d{4}$/.test(r[0] ?? "")).length === 6);
}

// ── prose is not forced into a table ──────────────────────────────────────
{
  const letter = [at("Dear Customer,", 40, 700), at("Please find your statement enclosed.", 40, 686)];
  const r = itemsToRows(letter);
  check("a covering letter comes back as lines, not columns",
    r.length === 2 && r[0].length === 1, JSON.stringify(r));
}

// ── THE MESSAGE THAT SENT HIM DOWN THE WRONG PATH ─────────────────────────
//
// Every failure used to arrive as "could not read text from this PDF (scanned
// images?)" because extractPdfText caught everything and returned "". The
// Axis files were password-protected — pdf.js raises PasswordException, which
// we were reporting as a scan. Nobody could have got from that message to
// "type your date of birth".
const pdf = readFileSync(join(import.meta.dirname, "..", "lib/pdf.ts"), "utf8");
check("a password-protected PDF says so",
  /name === "PasswordException"/.test(pdf) && /password-protected/.test(pdf));
check("and a wrong password is told apart from a missing one",
  /that password did not open the PDF/.test(pdf));
check("a file that is not a PDF says that instead",
  /this is not a PDF file/.test(pdf));
check("a damaged file says that", /the PDF is damaged/.test(pdf));
check("a download failure carries its status", /the file could not be downloaded \(\$\{r\.status\}\)/.test(pdf));
check("‘it is a scan’ is now one specific outcome, not the catch-all",
  /page\(s\) are images, so it is a scan or a screenshot/.test(pdf));
check("the password can be supplied", /password: opts\.password/.test(pdf));

const bank = readFileSync(join(import.meta.dirname, "..", "lib/bankStatements.ts"), "utf8");
/** Comments quote the old message on purpose; the CODE must not still emit it. */
const code = (src: string) => src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
check("the guess is gone",
  !/scanned images\?/.test(code(bank)),
  "that sentence covered a download failure, a renamed file, a damaged file and an encrypted one");
check("the PDF is tried as a TABLE before any model is asked",
  /const table = await readPdfRows\(fileUrl/.test(bank) &&
  bank.indexOf("readPdfRows") < bank.indexOf("parseBankStatementText"),
  "flattening a table to prose throws away where each number sits, then asks a model to guess it back");
check("the model remains as the fallback", /parseBankStatementText/.test(bank));
check("the password is passed in, never stored",
  /pdfPassword\?: string/.test(bank) && !/pdf_password/.test(bank));

const acts = readFileSync(join(import.meta.dirname, "..", "app/admin/zoho/actions.ts"), "utf8");
check("the upload form's password reaches the reader",
  /ingestStatement\(accountName, `secure:\$\{path\}`, file!\.name, \{ pdfPassword \}\)/.test(acts));
check("and a failed statement can be retried with one",
  /pdfPassword: str\(formData\.get\("pdf_password"\)\)/.test(acts));
check("the password is not written to the database",
  !/pdf_password/.test(readFileSync(join(import.meta.dirname, "..", "lib/bankStatements.ts"), "utf8")));

// ── the row parser can be loaded at all ───────────────────────────────────
check("the statement row rules import nothing, so they can be tested",
  !/^import /m.test(readFileSync(join(import.meta.dirname, "..", "lib/bankStatementRows.ts"), "utf8")),
  "they used to sit in a file that pulls in Supabase and Zoho, so no test could load them");

// ── the third reader, for a statement with no text in it at all ──────────
//
// Once the messages stopped guessing, his three uploads showed three different
// problems: the Axis 8882 card gave 488 characters — the name and address block
// — and nothing else, the NRE statement's two pages carry no text whatsoever,
// and the NRO one had never been retried. Some banks draw the transaction table
// as a picture, and no amount of parsing helps with that.
check("there is a reader for a statement whose pages are pictures",
  /parseBankStatementFile/.test(bank) && /readPdfBase64/.test(bank));
check("it runs LAST, after the table and the text",
  bank.indexOf("readPdfRows") < bank.indexOf("parseBankStatementText") &&
  bank.indexOf("parseBankStatementText") < bank.lastIndexOf("parseBankStatementFile"),
  "whole pages as images is the most expensive and least certain route");
check("each reader's failure is kept, so the note says what was tried",
  /const why: string\[\] = \[\]/.test(bank) && /why\.join\("; "\)/.test(bank),
  "‘it did not work’ is not something a desk can act on");
check("an encrypted PDF is never sent to be read as pictures",
  /an encrypted PDF cannot be sent for that — save an unlocked copy/.test(bank),
  "we can open it here with the password; the model receives the file and meets the same lock");
check("a switched-off or unconfigured AI is named, not blamed on the file",
  /Statement reading is switched OFF in Admin → AI training/.test(bank));

const ai = readFileSync(join(import.meta.dirname, "..", "lib/ai.ts"), "utf8");
const vision = ai.slice(ai.indexOf("export async function parseBankStatementFile"));
check("the PDF goes as a document, which is what makes the pages readable",
  /type: "document", source: \{ type: "base64", media_type: "application\/pdf"/.test(vision));
check("a card purchase is a debit and a payment to the card a credit",
  /On a CREDIT CARD statement a purchase is a debit and a payment or refund to the card is a credit/.test(vision),
  "the sign convention is the one thing a model must not invent on a card");
check("an unreadable figure is left out rather than guessed",
  /leave that field out rather than guessing at it/.test(vision),
  "a plausible wrong amount is worse than a gap");
check("its cost is logged like every other call", /logUsage\("bankstmt", model/.test(vision));
check("it respects the same feature switch", /aiFeatureDisabled\("bankstmt"\)/.test(vision));

// ── one box, whatever they have ──────────────────────────────────────────
//
// "Why don't you simplify the system? Just like you are checking the student
//  paper, which is so bad handwriting. You should put one method where you can
//  upload the document. You should go to the next step." — 2 September 2026.
//
// The comparison is the argument: the paper checker reads handwriting off a
// phone camera and asks the student nothing. The statement upload had grown the
// other way — five accepted extensions, a password box on every upload, and a
// failure that told the desk to go and find a different file.
const upload = readFileSync(join(import.meta.dirname, "..", "app/admin/zoho/StatementUpload.tsx"), "utf8");
const zohoPage = readFileSync(join(import.meta.dirname, "..", "app/admin/zoho/statements/page.tsx"), "utf8");
check("the box takes a photograph as readily as a spreadsheet",
  /accept="\.csv,\.txt,\.xls,\.xlsx,\.pdf,image\/\*"/.test(upload));
check("several photographs become one file, in page order",
  /photosToPdf\(sorted\.length \? sorted : photos\)/.test(upload),
  "a statement runs to more than one page and nobody should upload them one at a time");
check("and they are shrunk first, because a phone photo is megabytes",
  /shrinkPdf\(pdf/.test(upload), "a server action takes 8MB in total");
check("the password is folded away until it is wanted",
  /<summary className="btn small secondary as-btn"[^>]*>🔒 It has a password/.test(upload),
  "asked on every upload, it is a question nobody should be asked twice");
check("the page uses it", /<StatementUpload accounts=\{bankChoices\} \/>/.test(zohoPage));

check("a picture goes straight to the reader that can see it",
  /\.\(png\|jpe\?g\|webp\|heic\|heif\|gif\|bmp\|tiff\?\)\$/.test(bank));
check("and an unrecognised extension is TRIED, not refused",
  !/unsupported file type/.test(code(bank)),
  "refusing a file for its name is exactly the ceremony being removed");
check("the desk is no longer told to go and find an Excel version",
  !/upload the EXCEL version instead/.test(code(bank)) &&
  !/always the surer route/.test(code(bank)),
  "that is the portal asking the desk to do its job");
check("one reader serves a page and a photograph alike",
  /export async function parseBankStatementFile\(dataB64: string, mediaType = "application\/pdf"\)/.test(
    readFileSync(join(import.meta.dirname, "..", "lib/ai.ts"), "utf8")));

console.log(fails === 0 ? "ok — PDF statements" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
