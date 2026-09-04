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
  // A US CARD PRINTS "$37.32", AND "-$190.32" FOR A PAYMENT.
  //
  // The sign sits OUTSIDE the symbol, so the minus has to survive the strip —
  // taking "$" off "-$190.32" must leave "-190.32", not "190.32". His Citi
  // Costco statement of April 2026 came through as six rows of zero because
  // "$" was not in this list at all: Number("$37.32") is NaN, NaN became 0,
  // and every row was dropped as a nil line.
  const cleaned = String(v ?? "")
    .replace(/^\s*(-)?\s*(INR|RS\.?|USD|EUR|GBP|AED|[₹$€£])\s*/i, "$1")
    // "12,340.00 Cr" — a card statement's direction marker, which is read
    // where the amount is read and must not turn the figure into NaN here.
    .replace(/\s*(cr|dr)\.?\s*$/i, "")
    .replace(/[₹$€£,\s]/g, "")
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
  // A CARD WRITES THE YEAR WITH AN APOSTROPHE: "18 Jul '26".
  //
  // Without the quote here the match stopped at the month and returned "", and
  // an empty date is how a statement dies quietly: rowsToLines proves a header
  // by finding two parseable dates beneath it, so the Axis card statement of
  // 2 September was rejected with "could not find the header row" while its
  // header — Date | Transaction Details | Amount (INR) | Debit/Credit — sat in
  // the error message being printed back at the reader.
  //
  // Both quotes, because a PDF usually carries the typographic one.
  m = s.match(/^(\d{1,2}) ?([A-Za-z]{3})[A-Za-z]* ?['\u2019]?(\d{2,4})/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${mo}-${m[1].padStart(2, "0")}`;
  }
  return "";
}

// ---- tabular parsing (CSV / XLSX → rows → lines) ---------------------------

export type StmtLine = { date: string; narration: string; ref: string; debit: number; credit: number; balance: number | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ONE DIRECTION, ALWAYS A POSITIVE FIGURE.
 *
 * His instruction, 3 September 2026: "the amounts are showing negative
 * sometimes positive, whereas the amount should be positive".
 *
 * He is right, and not only about the display. An amount carries no sign in
 * double entry — the SIDE carries the meaning, and a figure is always a
 * magnitude. A statement that writes a refund as −6,900 in the withdrawal
 * column is saying "this is a deposit", and storing it as a negative
 * withdrawal leaves every reader downstream to work that out again, which is
 * exactly where a direction gets lost.
 *
 * So it is worked out ONCE, here: a negative on one side is a positive on the
 * other, and what comes out is a magnitude on exactly one side.
 */
export function asMagnitudes(debit: number, credit: number): { debit: number; credit: number } {
  let d = Number(debit) || 0, c = Number(credit) || 0;
  if (d < 0) { c += -d; d = 0; }
  if (c < 0) { d += -c; c = 0; }
  // BOTH COLUMNS FILLED IS A MIS-READ, NOT A TRANSACTION.
  //
  // No bank line is a withdrawal and a deposit at once; when a PDF's columns
  // are rebuilt from where the words sit, one figure can land in both. Netting
  // them would silently invent a third number, so the larger — the one that is
  // almost always the real figure, the other being a balance or a duplicate —
  // is kept whole and the smaller dropped. correctByBalance below then gets
  // the final say wherever the statement carries a running balance.
  if (d > 0 && c > 0) { if (d >= c) c = 0; else d = 0; }
  return { debit: r2(d), credit: r2(c) };
}

/**
 * THE RUNNING BALANCE IS THE BANK'S OWN ARITHMETIC. WHERE IT DISAGREES WITH
 * THE COLUMNS, IT WINS.
 *
 * 3 September 2026. Two lines of ₹6,900 on 18 August in the NRO account — one
 * from the NIRC branch, one returned by a person — were both filed as money
 * OUT, so answering "Drawings" produced *Drawings Dr / Bank Cr* on money that
 * had come IN. His words: "we got 6900 back from a person, the entry should be
 * bank account debit drawings, but it is showing drawings account debit to
 * Bank".
 *
 * The statement was a PDF. Its columns are rebuilt from where each number sits
 * on the page, and a deposit printed a little to the left lands in the
 * withdrawal column. Both rows carried a balance that ROSE by 6,900 while the
 * row said withdrawal — the file contradicted itself in plain sight.
 *
 * Deciding direction from the column alone can never catch that. Deciding it
 * from the balance can: the closing balance of one line and of the next differ
 * by exactly the movement between them, and that arithmetic is the bank's, not
 * ours. So where a statement carries a balance column, it is the authority.
 *
 * Deliberately conservative — it only acts when the balance change matches the
 * amount to the paisa. A statement whose balances are absent, mis-read, or out
 * of order is left exactly as parsed rather than being "corrected" on a guess.
 *
 * Lines must already be in statement order.
 */
export function correctByBalance(
  lines: StmtLine[],
  openingBalance?: number | null,
): { lines: StmtLine[]; fixed: number } {
  let fixed = 0;
  const out = lines.map((l) => ({ ...l }));
  let prev = openingBalance === undefined || openingBalance === null ? null : Number(openingBalance);

  for (const l of out) {
    const amount = l.debit || l.credit;
    if (l.balance === null || prev === null || amount <= 0) { prev = l.balance; continue; }
    const delta = r2(l.balance - prev);
    // Only where the bank's own movement IS this line's amount. Anything else
    // — a missing row, a mid-statement fee folded into the balance — and we
    // have no business overruling the columns.
    if (Math.abs(Math.abs(delta) - amount) > 0.01) { prev = l.balance; continue; }
    const shouldBeIn = delta > 0;
    const isIn = l.credit > 0;
    if (shouldBeIn !== isIn) {
      l.debit = shouldBeIn ? 0 : amount;
      l.credit = shouldBeIn ? amount : 0;
      fixed++;
    }
    prev = l.balance;
  }
  return { lines: out, fixed };
}


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
  // "Transaction Type" is what Axis calls the CR/DR column on a bank statement;
  // on its CARD statement the same column is spelled out, "Debit/Credit".
  drcr: /^(dr\/?cr|type|cr\/?dr|debit ?\/ ?credit|credit ?\/ ?debit|transaction ?type|txn ?type|type ?of ?transaction)$/i,
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
        // ONE COLUMN CANNOT BE BOTH AMOUNT COLUMNS.
        //
        // The loose pass matches on any WORD in a header, so "Debit / Credit"
        // — one column holding the word "Debit" or "Credit" per row — answered
        // to the debit pattern and the credit pattern alike and was recorded
        // as both. num("Debit") is 0, so every row came out as nothing on
        // either side and was dropped, and a statement whose figures were sat
        // in plain sight reported "no transaction rows parsed under it".
        //
        // A column that answers to both is naming a DIRECTION, not carrying an
        // amount. The single-amount branch below already knows what to do with
        // one; it just has to be told this is one.
        if (cols.debit !== undefined && cols.debit === cols.credit) {
          if (cols.drcr === undefined) cols.drcr = cols.debit;
          delete cols.debit; delete cols.credit;
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

  // IS THE ONE AMOUNT COLUMN A SIGNED ONE?
  //
  // Decided from the whole file before any row is read, because a single row
  // cannot tell you. Exports that use one amount column come in two kinds:
  // signed (−6,900 out, 6,900 in) and unsigned-with-a-marker ("6,900.00 Cr").
  // Reading a signed column as though it were unsigned throws the direction
  // away — see the Math.abs that used to live below, which made a withdrawal
  // of every line in a signed file.
  const amountIsSigned =
    cols.amount !== undefined &&
    rows.slice(hi + 1).some((r) => {
      const v = str((r ?? [])[cols.amount]);
      return v !== "" && num(v) < 0;
    });

  for (const raw of rows.slice(hi + 1)) {
    const cell = (k: string) => (cols[k] !== undefined ? str(raw[cols[k]]) : "");
    const date = parseIndianDate(cell("date"));
    if (!date) continue; // totals/footers
    let debit = num(cell("debit")), credit = num(cell("credit"));
    if (!cols.debit && !cols.credit && cols.amount !== undefined) {
      // ONE AMOUNT COLUMN, AND THE DIRECTION WHEREVER THE STATEMENT PUTS IT.
      //
      // Three places it can be, in the order they are trusted:
      //
      //   1. AN EXPLICIT MARKER — a Dr/Cr column, or the word inside the
      //      amount cell ("12,340.00 Cr"). Unambiguous, so it wins. On a card
      //      a "Cr" is a payment or a refund: it reduces what is owed, which
      //      is the credit column here, the same as money arriving in a bank.
      //   2. THE SIGN, where the column carries signs at all. Negative is
      //      money out. This used to be discarded by Math.abs.
      //   3. Neither — then it is money out, which is what most single-column
      //      exports without a marker are.
      const cellText = cell("amount");
      const amt = num(cellText);
      const marker = (cell("drcr") || cellText).toLowerCase();
      const saysCr = /\bcr\b|\bcredit\b/.test(marker);
      const saysDr = /\bdr\b|\bdebit\b/.test(marker);
      if (saysCr || saysDr) {
        if (saysCr) credit = Math.abs(amt); else debit = Math.abs(amt);
      } else if (amountIsSigned) {
        if (amt < 0) debit = -amt; else credit = amt;
      } else {
        debit = Math.abs(amt);
      }
    }
    // One side, always positive — see asMagnitudes.
    ({ debit, credit } = asMagnitudes(debit, credit));
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
