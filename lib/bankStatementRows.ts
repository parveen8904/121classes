// PARSING A STATEMENT'S ROWS — AND NOTHING ELSE.
//
// Moved out of lib/bankStatements.ts on 2 September 2026 so it can be RUN. The
// rules in here — which column is the narration, which of four reference
// columns wins, how a Dr/Cr marker is read, what an Indian date looks like —
// are the ones that decide what gets booked, and they were sitting in a file
// that imports Supabase and the Zoho client, so no test could load them. The
// existing test had to reconstruct the regexes out of the source text.
//
// Nothing here imports anything. It takes rows of strings, wherever they came
// from — a CSV, an Excel sheet, or a PDF whose table was rebuilt from where
// the words sit (lib/pdfTable.ts) — and returns statement lines.

export const str = (v: unknown) => String(v ?? "").trim();
export const num = (v: unknown) => {
  // AXIS PRINTS THE CURRENCY IN THE CELL: "INR 86,493.00".
  //
  // Stripping only ₹ and commas left "INR86493.00", which is NaN, which became
  // 0, which made every row look like a zero-value line and be skipped. The
  // whole statement came back as "no transaction lines found" while its figures
  // sat there in plain sight.
  const cleaned = String(v ?? "")
    .replace(/^\s*(INR|RS\.?|₹)\s*/i, "")
    // "12,340.00 Cr" — a card statement's direction marker, which is read
    // where the amount is read and must not turn the figure into NaN here.
    .replace(/\s*(cr|dr)\.?\s*$/i, "")
    .replace(/[₹,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

// ---- date handling ----------------------------------------------------------

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** dd/mm/yyyy · dd-mm-yy · dd MMM yyyy · yyyy-mm-dd → YYYY-MM-DD ("" if unparseable). */
export function parseIndianDate(raw: string): string {
  const s = str(raw).replace(/,/g, " ").replace(/\s+/g, " ");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2}) ?([A-Za-z]{3})[A-Za-z]* ?(\d{2,4})/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${mo}-${m[1].padStart(2, "0")}`;
  }
  return "";
}

// ---- tabular parsing (CSV / XLSX → rows → lines) ---------------------------

export type StmtLine = { date: string; narration: string; ref: string; debit: number; credit: number; balance: number | null };


export const HEAD = {
  date: /^(txn ?date|tran\.? ?date|transaction ?date|date|value ?date|posting ?date|date ?of ?transaction)$/i,
  // "Statement Description" is the column name the accounts desk uses in the
  // upload template — the transaction particulars belong here, NOT in the
  // reference, which Zoho caps at fifty characters.
  narration: /^(statement ?description|particulars?|narration|description|details|transaction ?(details|remarks|particulars?|description)|description ?of ?transaction|merchant ?(name)?|remarks|transaction)$/i,
  // Any of these IS a reference column; which one WINS is decided by REF_TIERS
  // below, because first-past-the-post picks the wrong one.
  ref: /^(internal ?ref(erence)? ?(no\.?|number)?|chq\.?\/?ref\.? ?(no\.?)?|ref(erence)? ?(no\.?|number)?|cheque ?(no\.?|number)|utr ?(no\.?|number)?|chqno|transaction ?ref(erence)? ?(no\.?|number)?)$/i,
  debit: /^(withdrawal ?(amt\.?)? ?(\(?inr\)?)?|debit ?(amt\.?)?|dr|dr\.? ?amount|withdrawals?|debits?)$/i,
  credit: /^(deposit ?(amt\.?)? ?(\(?inr\)?)?|credit ?(amt\.?)?|cr|cr\.? ?amount|deposits?|credits?)$/i,
  balance: /^(closing ?balance|balance|bal|running ?balance|balance ?(\(?inr\)?)?)$/i,
  // Card statements write the unit into the header: "Amount (in Rs.)".
  amount: /^(amount|amount ?\(?(in )?(inr|rs\.?)\)?|txn ?amount|transaction ?amount)$/i,
  // "Transaction Type" is what Axis calls the CR/DR column.
  drcr: /^(dr\/?cr|type|cr\/?dr|transaction ?type|txn ?type|type ?of ?transaction)$/i,
};

// WHICH REFERENCE COLUMN WINS, WHEN A STATEMENT CARRIES FOUR OF THEM.
//
// His Axis "Smart Statement" has Cheque Number, Internal Reference Number, UTR
// Number and Transaction ID. Taking the first column that looked like a
// reference took CHEQUE NUMBER — which is empty on every electronic line — so
// the reference came out blank and the posting fell back to digging a wire
// number out of the narration.
//
// Ravi asked for the internal reference number, and that is the right choice:
// it is filled on every line and it is what the bank quotes back. UTR next,
// because it is meaningful across banks; the cheque column last, since it only
// carries anything on an actual cheque.
export const REF_TIERS: RegExp[] = [
  /^internal ?ref(erence)? ?(no\.?|number)?$/i,
  /^(ref(erence)? ?(no\.?|number)?|transaction ?ref(erence)? ?(no\.?|number)?)$/i,
  /^utr ?(no\.?|number)?$/i,
  /^(chq\.?\/?ref\.? ?(no\.?)?|cheque ?(no\.?|number)|chqno)$/i,
];

export function rowsToLines(rows: string[][]): { lines: StmtLine[]; note: string } {
  // FINDING THE HEADER ROW, AND SAYING WHAT WENT WRONG WHEN IT IS NOT FOUND.
  //
  // Three Axis statements uploaded on 25 Aug 2026 all failed with "could not
  // find the header row", which told nobody anything: the file was never shown,
  // so there was no way to learn what its columns are actually called. Two
  // things changed here.
  //
  // First, it looks further and less rigidly. Bank exports carry a block of
  // account details above the table — 30 rows was optimistic — and the column
  // names vary ("Tran Date", "Transaction Particulars", "Withdrawal Amt."),
  // so an exact match is tried first and a contains-match second.
  //
  // Second, when it still cannot find the header, it REPORTS THE ROWS IT SAW.
  // That turns a dead end into something anyone can act on.
  const SCAN = Math.min(rows.length, 200);
  let hi = -1; const cols: Record<string, number> = {};

  // A HEADER THAT LEADS NOWHERE IS NOT THE HEADER.
  //
  // Loosening the match found "a Date column and a Description column" in an
  // Axis preamble block — the account summary above the table — and stopped
  // there. Every row after it then failed to yield a date, and the file came
  // back as "no transaction lines found" while the real table sat further
  // down, untouched.
  //
  // So a candidate now has to PROVE itself: at least two of the rows beneath it
  // must parse as a date in the column it claims. If none do, the search
  // carries on looking.
  const dateRowsUnder = (start: number, dateCol: number) => {
    let hits = 0;
    for (let j = start + 1; j < Math.min(rows.length, start + 40); j++) {
      if (parseIndianDate(str((rows[j] ?? [])[dateCol]))) hits++;
      if (hits >= 2) break;
    }
    return hits;
  };

  const locate = (loose: boolean) => {
    for (let i = 0; i < SCAN; i++) {
      const r = (rows[i] ?? []).map((c) => str(c));
      const find = (re: RegExp) => r.findIndex((c) => {
        if (re.test(c)) return true;
        if (!loose) return false;
        // Loose pass: the column name merely has to contain the word, so
        // "Transaction Particulars" and "Withdrawal Amt (INR)" still match.
        const bare = c.replace(/[^a-z ]/gi, " ").replace(/\s+/g, " ").trim();
        return bare.split(" ").some((w) => re.test(w)) || re.test(bare);
      });
      const dIdx = find(HEAD.date);
      if (dIdx >= 0 && find(HEAD.narration) >= 0 && dateRowsUnder(i, dIdx) >= 2) {
        hi = i;
        for (const [k, re] of Object.entries(HEAD)) {
          const idx = find(re);
          if (idx >= 0) cols[k] = idx;
        }
        // The reference column is chosen by priority, not by position — see
        // REF_TIERS. Without this, "Cheque Number" beats "Internal Reference
        // Number" simply by sitting further left, and it is always empty.
        for (const tier of REF_TIERS) {
          const idx = find(tier);
          if (idx >= 0) { cols.ref = idx; break; }
        }
        return true;
      }
    }
    return false;
  };

  if (!locate(false)) locate(true);

  if (hi < 0) {
    // Show the first rows that actually contain something, so the real column
    // names are visible without anybody opening the file by hand.
    const sample = rows
      .slice(0, 25)
      .map((r) => (r ?? []).map((c) => str(c)).filter(Boolean).join(" | "))
      .filter(Boolean)
      .slice(0, 6)
      .map((r) => (r.length > 120 ? `${r.slice(0, 120)}…` : r));
    return {
      lines: [],
      note:
        "could not find the header row (a Date column and a Particulars/Narration column). " +
        (sample.length ? `The file starts: ${sample.join(" ⏎ ")}` : "The file appeared to be empty."),
    };
  }

  const lines: StmtLine[] = [];
  // Kept so that "found the header, parsed nothing" can say what it was
  // looking at — the same reason the not-found case prints the file's first
  // rows. A failure that names no evidence cannot be acted on.
  const headerSeen = (rows[hi] ?? []).map((c) => str(c)).filter(Boolean).join(" | ").slice(0, 200);
  const firstDataRow = (rows[hi + 1] ?? []).map((c) => str(c)).filter(Boolean).join(" | ").slice(0, 200);

  for (const raw of rows.slice(hi + 1)) {
    const cell = (k: string) => (cols[k] !== undefined ? str(raw[cols[k]]) : "");
    const date = parseIndianDate(cell("date"));
    if (!date) continue; // totals/footers
    let debit = num(cell("debit")), credit = num(cell("credit"));
    if (!cols.debit && !cols.credit && cols.amount !== undefined) {
      // ONE AMOUNT COLUMN, AND THE DIRECTION WHEREVER THE CARD PUTS IT.
      //
      // Card statements mark it either in their own Dr/Cr column or inside the
      // amount cell — "12,340.00 Cr" — and the second form used to parse as
      // NaN, which became zero, which dropped the row. On a card a "Cr" is a
      // payment or a refund: it reduces what is owed, which is the credit
      // column here, the same as money arriving in a bank.
      const raw = cell("amount");
      const amt = num(raw);
      const t = (cell("drcr") || raw).toLowerCase();
      if (/\bcr\b|\bcredit\b/.test(t)) credit = Math.abs(amt);
      else debit = Math.abs(amt);
    }
    if (!debit && !credit) continue;
    lines.push({
      date,
      narration: cell("narration"),
      ref: cell("ref"),
      debit, credit,
      balance: cols.balance !== undefined && cell("balance") !== "" ? num(cell("balance")) : null,
    });
  }
  // Found the header and still parsed nothing: say what was under it, so the
  // real reason (a date format, a merged cell, an empty sheet) is visible.
  if (!lines.length) {
    return {
      lines,
      note:
        "found the header but no transaction rows parsed under it. " +
        `Header: ${headerSeen || "(blank)"} — first row beneath: ${firstDataRow || "(blank)"}`,
    };
  }
  return { lines, note: "" };
}

export function csvToRows(text: string): string[][] {
  // Small tolerant CSV: quoted fields, commas, CRLF.
  const rows: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (cur !== "" || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; }
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
