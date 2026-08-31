import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { resolveFileUrl, isSecureRef } from "@/lib/storage";
import { zohoReference } from "@/lib/zohoReference";

// BANK STATEMENTS → THE THREE QUEUES.
//
// A statement is uploaded per account (CSV / Excel / PDF). Every line must end
// in exactly one of: MATCHED (already in Zoho — the office's entry or our own
// settlement journal), AUTO (a merchant rule proposes the account; one tick
// posts it), or ASK (a human names the account once — the answer becomes a
// rule and the same merchant never asks again). Lines are parsed by CODE;
// only PDF text uses the fast AI model, and only to transcribe, never to
// categorise. Continuity: each statement's opening balance must equal the
// previous one's closing, so a missing fortnight cannot hide.

const str = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => {
  // AXIS PRINTS THE CURRENCY IN THE CELL: "INR 86,493.00".
  //
  // Stripping only ₹ and commas left "INR86493.00", which is NaN, which became
  // 0, which made every row look like a zero-value line and be skipped. The
  // whole statement came back as "no transaction lines found" while its figures
  // sat there in plain sight.
  const cleaned = String(v ?? "")
    .replace(/^\s*(INR|RS\.?|₹)\s*/i, "")
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


const HEAD = {
  date: /^(txn ?date|tran\.? ?date|transaction ?date|date|value ?date|posting ?date|date ?of ?transaction)$/i,
  // "Statement Description" is the column name the accounts desk uses in the
  // upload template — the transaction particulars belong here, NOT in the
  // reference, which Zoho caps at fifty characters.
  narration: /^(statement ?description|particulars?|narration|description|details|transaction ?(details|remarks|particulars?|description)|remarks|transaction)$/i,
  ref: /^(chq\.?\/?ref\.? ?(no\.?)?|ref(erence)? ?(no\.?|number)?|cheque ?(no\.?|number)|utr|chqno)$/i,
  debit: /^(withdrawal ?(amt\.?)? ?(\(?inr\)?)?|debit ?(amt\.?)?|dr|dr\.? ?amount|withdrawals?|debits?)$/i,
  credit: /^(deposit ?(amt\.?)? ?(\(?inr\)?)?|credit ?(amt\.?)?|cr|cr\.? ?amount|deposits?|credits?)$/i,
  balance: /^(closing ?balance|balance|bal|running ?balance|balance ?(\(?inr\)?)?)$/i,
  amount: /^(amount|amount ?\(?inr\)?|txn ?amount)$/i,
  // "Transaction Type" is what Axis calls the CR/DR column.
  drcr: /^(dr\/?cr|type|cr\/?dr|transaction ?type|txn ?type|type ?of ?transaction)$/i,
};

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
      // Single amount column with a Dr/Cr marker (many card statements).
      const amt = num(cell("amount"));
      const t = cell("drcr").toLowerCase();
      if (t.startsWith("cr")) credit = Math.abs(amt);
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

function csvToRows(text: string): string[][] {
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

// ---- ingestion --------------------------------------------------------------

async function fetchFile(fileUrl: string): Promise<{ buf: ArrayBuffer } | null> {
  const target = isSecureRef(fileUrl) ? await resolveFileUrl(fileUrl, 120) : fileUrl;
  if (!target) return null;
  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) return null;
  return { buf: await res.arrayBuffer() };
}

/**
 * Parse an uploaded statement, run continuity, and file every line into its
 * queue. Returns a human summary for the banner.
 */
export async function ingestStatement(accountName: string, fileUrl: string, fileName: string): Promise<string> {
  const svc = createServiceClient();
  const f = await fetchFile(fileUrl);
  if (!f) return "Could not read the uploaded file.";

  let lines: StmtLine[] = [];
  let note = "";
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const r = rowsToLines(csvToRows(new TextDecoder().decode(f.buf)));
    lines = r.lines; note = r.note;
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(f.buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false }) as unknown as string[][];
    const r = rowsToLines(rows.map((x) => (x ?? []).map((c) => str(c))));
    lines = r.lines; note = r.note;
  } else if (lower.endsWith(".pdf")) {
    const { extractPdfText } = await import("@/lib/pdf");
    const text = isSecureRef(fileUrl) ? await extractPdfText(fileUrl) : await extractPdfText(fileUrl);
    if (!text) note = "could not read text from this PDF (scanned images?)";
    else {
      const { parseBankStatementText } = await import("@/lib/ai");
      const ai = await parseBankStatementText(text);
      // Evidence, not a shrug: the xlsx path taught us a failure that shows
      // what it saw is a failure that gets fixed the same day.
      if (!ai) note = `the PDF's text was read (${text.length} chars) but the transcription returned nothing — it starts: "${text.slice(0, 90).replace(/\s+/g, " ")}"`;
      else lines = ai.map((l) => ({
        date: parseIndianDate(l.date) || str(l.date),
        narration: str(l.narration), ref: str(l.ref),
        debit: Math.abs(Number(l.debit) || 0), credit: Math.abs(Number(l.credit) || 0),
        balance: l.balance !== undefined && l.balance !== null ? Number(l.balance) : null,
      })).filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && (l.debit || l.credit));
    }
  } else {
    note = "unsupported file type — upload CSV, Excel or PDF";
  }

  if (!lines.length) {
    await svc.from("bank_statements").insert({ account_name: accountName, file_url: fileUrl, file_name: fileName, status: "failed", note: note || "no transaction lines found" });
    return `Statement could not be parsed: ${note || "no transaction lines found"}.`;
  }

  lines.sort((a, b) => a.date.localeCompare(b.date));
  const first = lines[0], last = lines[lines.length - 1];
  // Opening = first balance rolled back by the first movement; null when the
  // statement carries no balance column (continuity then stays unknown).
  const opening = first.balance !== null ? first.balance + first.debit - first.credit : null;
  const closing = last.balance;

  // Continuity: against the latest previous statement for the same account.
  const { data: prev } = await svc.from("bank_statements")
    .select("closing_balance, period_end").eq("account_name", accountName).eq("status", "parsed")
    .not("closing_balance", "is", null).order("period_end", { ascending: false }).limit(1).maybeSingle();
  const continuity = prev?.closing_balance !== undefined && prev?.closing_balance !== null && opening !== null
    ? Math.abs(Number(prev.closing_balance) - opening) < 0.01
    : null;

  const { data: stmt } = await svc.from("bank_statements").insert({
    account_name: accountName, file_url: fileUrl, file_name: fileName,
    period_start: first.date, period_end: last.date,
    opening_balance: opening, closing_balance: closing,
    continuity_ok: continuity, lines_total: lines.length,
    note: continuity === false ? `opening ${opening} ≠ previous closing ${prev?.closing_balance} — a statement may be missing in between` : null,
  }).select("id").single();
  if (!stmt) return "Could not record the statement.";

  // Duplicate guard: a line already ingested (overlapping statements) is filed once.
  const { data: existing } = await svc.from("bank_lines")
    .select("line_date, narration, debit, credit").eq("account_name", accountName)
    .gte("line_date", first.date).lte("line_date", last.date);
  const seen = new Set((existing ?? []).map((e) => `${e.line_date}|${str(e.narration)}|${e.debit}|${e.credit}`));

  // Pre-load the matching sources for the period.
  const [{ data: settleRows }, rules, zohoExp, zohoTxns] = await Promise.all([
    // The settlement's own amount and date, not just its UTR — see below.
    svc.from("zoho_settlements").select("utr, settlement_id, status, settled_on, net_inr").in("status", ["posted", "matched"]),
    svc.from("merchant_rules").select("id, pattern, account_name, sub_account").then((r) => r.data ?? []),
    fetchZohoExpensesFor(accountName, first.date, last.date),
    fetchZohoBankTxnsFor(accountName, first.date, last.date),
  ]);
  const utrs = new Map((settleRows ?? []).filter((s) => s.utr).map((s) => [String(s.utr), String(s.settlement_id)]));
  // A SETTLEMENT IS RECOGNISABLE WITHOUT ITS UTR.
  //
  // Axis writes "Razorpay Software Pvt  Ltd  Fu" and no UTR, so matching on the
  // UTR alone never fired and every settlement he had already posted came back
  // as a fresh question. The amount and the date identify it perfectly well.
  const settleByAmt = new Map<string, string>();
  for (const r of settleRows ?? []) {
    const d = String((r as { settled_on?: string }).settled_on ?? "").slice(0, 10);
    // net_inr is what Razorpay actually deposits — gross less their fee and its
    // GST — so it is the figure the bank statement shows.
    const a = Number((r as { net_inr?: number }).net_inr ?? 0);
    if (d && a > 0) settleByAmt.set(`${d}|${a.toFixed(2)}`, String(r.settlement_id));
  }

  let matched = 0, auto = 0, ask = 0, dup = 0;
  const usedExp = new Set<string>();
  for (const l of lines) {
    const key = `${l.date}|${l.narration}|${l.debit}|${l.credit}`;
    if (seen.has(key)) { dup++; continue; }
    seen.add(key);

    let status = "ask"; let proposal: Record<string, unknown> | null = null;
    let zohoId: string | null = null; let matchedNote: string | null = null;

    // 1) Our own settlement journals — the UTR travels in the narration.
    const hitUtr = [...utrs.keys()].find((u) => u.length >= 8 && (l.narration.includes(u) || l.ref === u));
    if (hitUtr && l.credit > 0) {
      status = "matched"; matchedNote = `Razorpay settlement (UTR ${hitUtr})`;
    }

    // 1b) A settlement we posted, recognised by its amount and date.
    if (status === "ask" && l.credit > 0) {
      const sid = settleByAmt.get(`${l.date}|${l.credit.toFixed(2)}`);
      if (sid) { status = "matched"; matchedNote = `Razorpay settlement (already posted)`; }
    }

    // 2) The office's existing Zoho expenses for this account: amount + date.
    if (status === "ask" && l.debit > 0) {
      const k = `${l.date}|${l.debit.toFixed(2)}`;
      const exp = zohoExp.get(k)?.find((e) => !usedExp.has(e.id));
      if (exp) {
        usedExp.add(exp.id);
        status = "matched"; zohoId = exp.id; matchedNote = `already entered (${exp.account})`;
      }
    }

    // 2b) ANYTHING ELSE ALREADY IN THIS ACCOUNT'S ZOHO REGISTER — a journal, a
    // transfer, a receipt, a payment, or something typed in by hand. Both
    // directions, each Zoho entry claimed at most once.
    if (status === "ask") {
      const dir = l.debit > 0 ? "out" : "in";
      const amt = (l.debit > 0 ? l.debit : l.credit).toFixed(2);
      const t = zohoTxns.get(`${l.date}|${amt}|${dir}`)?.find((x) => !usedExp.has(x.id));
      if (t) {
        usedExp.add(t.id);
        status = "matched"; zohoId = t.id;
        matchedNote = `already in Zoho — ${t.type}${t.note ? ` (${t.note})` : ""}`;
      }
    }

    // 3) Merchant rules — the taught mappings.
    if (status === "ask") {
      const up = l.narration.toUpperCase();
      const rule = rules.find((r) => up.includes(String(r.pattern).toUpperCase()));
      if (rule) {
        status = "auto";
        // A rule carries its sub-account too, so a merchant taught once keeps
        // its qualifier every month rather than being re-typed.
        proposal = {
          account: rule.account_name,
          subAccount: (rule as { sub_account?: string | null }).sub_account ?? null,
          kind: l.debit > 0 ? "expense" : "journal", ruleId: rule.id,
        };
      }
    }

    await svc.from("bank_lines").insert({
      statement_id: stmt.id, account_name: accountName,
      sub_account: (proposal as { subAccount?: string | null } | null)?.subAccount ?? null,
      line_date: l.date, narration: l.narration, ref: l.ref || null,
      debit: l.debit, credit: l.credit, balance: l.balance,
      status, proposal, zoho_id: zohoId, matched_note: matchedNote,
    });
    if (status === "matched") matched++; else if (status === "auto") auto++; else ask++;
  }

  const cont = continuity === false ? " ⚠️ CONTINUITY BREAK — see the statement note." : continuity ? " Continuity ✓." : "";
  return `${lines.length} line(s): ${matched} matched, ${auto} auto-proposed, ${ask} to answer${dup ? `, ${dup} duplicate(s) skipped` : ""}.${cont}`;
}

type ZExp = { id: string; account: string };
/**
 * EVERYTHING THAT HAS ALREADY MOVED THROUGH THIS BANK ACCOUNT IN ZOHO.
 *
 * His complaint, 26 Aug 2026: entries already passed — by the Razorpay
 * clearing button, or typed into Zoho by hand — are asked for all over again
 * when the statement is uploaded. "Entries which are already recognised in
 * Zoho should not be again asked in portal."
 *
 * The old matching could not see them. It looked at two things: our own
 * settlement journals, found only when the UTR happens to appear in the bank's
 * narration — and Axis writes "Razorpay Software Pvt  Ltd  Fu", with no UTR at
 * all — and Zoho EXPENSES, which by definition are only money going out. A
 * receipt entered by hand, a journal, a transfer, a customer payment: none of
 * them could ever match, so every one came back as a question.
 *
 * /banktransactions is the account's own register, which is where all of those
 * land whatever document created them. Matched on date and amount, in the
 * right direction, each Zoho entry claimed at most once.
 */
type ZTxn = { id: string; type: string; note: string };

async function fetchZohoBankTxnsFor(accountName: string, from: string, to: string): Promise<Map<string, ZTxn[]>> {
  const map = new Map<string, ZTxn[]>();
  try {
    const acct = await zohoAccountId(accountName);
    for (let page = 1; page <= 10; page++) {
      const r = await zohoFetch<{
        banktransactions?: { transaction_id: string; date: string; amount: number; debit_or_credit?: string;
          transaction_type?: string; description?: string; payee?: string }[];
        page_context?: { has_more_page?: boolean };
      }>("/banktransactions", {
        query: { account_id: acct, date_start: from, date_end: to, per_page: "200", page: String(page) },
      });
      for (const t of r.banktransactions ?? []) {
        // Zoho reports the direction from the BANK's side: a credit to the
        // bank is money in, which is the statement's credit column.
        const dir = String(t.debit_or_credit ?? "").toLowerCase() === "credit" ? "in" : "out";
        const k = `${t.date}|${Math.abs(Number(t.amount)).toFixed(2)}|${dir}`;
        const arr = map.get(k) ?? [];
        arr.push({
          id: String(t.transaction_id),
          type: String(t.transaction_type ?? "entry"),
          note: String(t.payee || t.description || "").slice(0, 60),
        });
        map.set(k, arr);
      }
      if (!r.page_context?.has_more_page) break;
    }
  } catch { /* matching is best-effort; unmatched lines simply ask */ }
  return map;
}

async function fetchZohoExpensesFor(accountName: string, from: string, to: string): Promise<Map<string, ZExp[]>> {
  const map = new Map<string, ZExp[]>();
  try {
    const acct = await zohoAccountId(accountName);
    for (let page = 1; page <= 10; page++) {
      const r = await zohoFetch<{ expenses?: { expense_id: string; date: string; bcy_total: number; account_name: string }[]; page_context?: { has_more_page?: boolean } }>(
        "/expenses", { query: { paid_through_account_id: acct, date_start: from, date_end: to, per_page: "200", page: String(page) } });
      for (const e of r.expenses ?? []) {
        const k = `${e.date}|${Number(e.bcy_total).toFixed(2)}`;
        const arr = map.get(k) ?? [];
        arr.push({ id: e.expense_id, account: e.account_name });
        map.set(k, arr);
      }
      if (!r.page_context?.has_more_page) break;
    }
  } catch { /* matching is best-effort; unmatched lines simply ask */ }
  return map;
}

const acctCache = new Map<string, { id: string; type: string }>();

/** The account, with its TYPE — which decides what shape the entry may take. */
export async function zohoAccount(name: string): Promise<{ id: string; type: string }> {
  const hit = acctCache.get(name);
  if (hit) return hit;
  const r = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string; account_type: string }[] }>(
    "/chartofaccounts", { query: { search_text: name, filter_by: "AccountType.All" } });
  const found = (r.chartofaccounts ?? []).find((a) => a.account_name === name);
  if (!found) throw new Error(`Zoho account "${name}" not found`);
  const out = { id: found.account_id, type: String(found.account_type ?? "") };
  acctCache.set(name, out);
  return out;
}

export async function zohoAccountId(name: string): Promise<string> {
  return (await zohoAccount(name)).id;
}

/** Only these can carry a Zoho Expense. Everything else has to be a journal. */
const EXPENSE_TYPES = new Set(["expense", "other_expense", "cost_of_goods_sold"]);

// ---- posting one line -------------------------------------------------------

/** Post an approved line. Debits become Expenses (the office's style: narration
 *  verbatim, paid through the bank account); credits become journals
 *  (Dr bank / Cr the chosen account). */
/**
 * The statement page behind a line, attached to whatever the line became.
 *
 * A bank entry with no paper is the hardest kind to check months later: the
 * narration is a bank's abbreviation and nothing says where it came from. The
 * statement itself answers that.
 */
async function attachStatement(
  svc: ReturnType<typeof createServiceClient>, line: Record<string, unknown>,
  kind: "expense" | "journal" | "vendorpayment" | "customerpayment", zohoId: string,
): Promise<string | null> {
  if (!line.statement_id) return null;
  const { data: st } = await svc.from("bank_statements")
    .select("file_url, file_name, account_name, period_start, period_end").eq("id", line.statement_id).maybeSingle();
  if (!st?.file_url) return null;
  const { attachToZoho } = await import("@/lib/zohoAttach");
  const name = String(st.file_name || `${st.account_name} ${st.period_start} to ${st.period_end}.pdf`);
  const att = await attachToZoho(kind, zohoId, String(st.file_url), name);
  return att.ok ? null : `posted, but the statement is not attached (${att.note})`;
}

/**
 * Post one answered bank line.
 *
 * `subAccount` is the qualifier that says WHICH of a thing this is — Courier
 * Expenses (Delhi office), Rent (Nirman Vihar). Exactly what a supplier bill
 * already carries, and for the same reason: the ledger line is all an auditor
 * or the department ever sees of an entry, so "which one" belongs in it.
 * It is NOT a separate Zoho account; nothing new is created in the chart.
 */
export async function postBankLine(
  lineId: string, accountChoice: string, subAccount?: string | null,
  opts?: { nature?: string | null; operating?: string | null },
): Promise<void> {
  const svc = createServiceClient();
  const { data: l } = await svc.from("bank_lines").select("*").eq("id", lineId).maybeSingle();
  if (!l) throw new Error("line not found");
  if (l.status === "posted" || l.status === "matched") return;

  const fail = async (msg: string) => {
    await svc.from("bank_lines").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", lineId);
    throw new Error(msg);
  };

  try {
    const bankId = await zohoAccountId(String(l.account_name));
    const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0;
    const { lineNarration } = await import("@/lib/zohoNarration");

    // A LINE THAT SETTLES SOMETHING IS NOT AN EXPENSE.
    //
    // The expense was booked when the supplier's bill arrived. Paying it is a
    // payment against that bill — book it as an expense again and the cost is
    // counted twice while the bill stays open for ever. The same the other way:
    // rent received settles the tenant's invoice, it is not fresh income.
    if (l.match_kind && Array.isArray(l.match_ids) && l.match_ids.length) {
      const { settleFromBank } = await import("@/lib/bankSettle");
      const zid = await settleFromBank({
        kind: String(l.match_kind) as "bill" | "invoice",
        documentIds: (l.match_ids as string[]).map(String),
        amount: debit > 0 ? debit : credit,
        date: String(l.line_date),
        bankAccountId: bankId,
        reference: zohoReference(l.ref as string | null, l.narration as string | null),
        // A receipt or a payment says what it settles, not merely that money
        // moved: the head it clears and the document count, then the bank's own
        // words kept as the source.
        narration: lineNarration({
          who: String(l.account_name),
          what: String(l.match_kind) === "bill"
            ? `payment against ${(l.match_ids as string[]).length} supplier bill(s)`
            : `receipt against ${(l.match_ids as string[]).length} invoice(s)`,
          docNo: String(l.ref ?? "") || null, docLabel: "bank ref",
          docDate: String(l.line_date),
          extra: `bank statement: ${String(l.narration ?? "").slice(0, 220)}`,
        }),
      });
      const paper = await attachStatement(svc, l, String(l.match_kind) === "bill" ? "vendorpayment" : "customerpayment", zid);
      await svc.from("bank_lines").update({
        status: "posted", zoho_id: zid, error: paper, updated_at: new Date().toISOString(),
      }).eq("id", lineId);
      return;
    }

    // THE LEDGER HE PICKED, CREATED IF IT DOES NOT EXIST YET.
    //
    // Bills could always create a missing ledger; a bank line THREW "account
    // not found" — so the desk could only file money against heads somebody
    // had already made in Zoho by hand. The same nature and operating answers
    // the invoice panel takes decide the new ledger's type here, and
    // "drawings" maps to equity, never the P&L.
    let other: { id: string; type: string };
    try {
      other = await zohoAccount(accountChoice);
    } catch {
      const { zohoAccountType } = await import("@/lib/postingShape");
      const nature = String(opts?.nature ?? (l.proposal as { nature?: string } | null)?.nature ?? "expense");
      const operating = String(opts?.operating ?? (l.proposal as { operating?: string } | null)?.operating ?? "operating");
      const acctType = zohoAccountType(nature as never, operating as never);
      const made = await zohoFetch<{ chart_of_account?: { account_id: string } }>("/chartofaccounts", {
        method: "POST",
        body: {
          account_name: /\(AI\)$/.test(accountChoice.trim()) ? accountChoice.trim() : `${accountChoice.trim()} (AI)`,
          account_type: acctType,
        },
      });
      if (!made.chart_of_account?.account_id) return fail(`could not create the ledger "${accountChoice}"`);
      other = { id: made.chart_of_account.account_id, type: acctType };
    }
    const otherId = other.id;

    // THE REFERENCE, ALWAYS. The bank's ref column is usually empty (Axis puts
    // the wire number inside the narration), so reference_number was blank on
    // most postings while the settlement journals all carry their UTR. The wire
    // number is lifted out of the narration when the column gives nothing —
    // see zohoReference, and the five expenses it stopped failing.
    const refNo = zohoReference(l.ref as string | null, l.narration as string | null);

    // A BANK'S OWN WORDING IS NOT A NARRATION.
    //
    // "NEFT-AXISP0012345-VERCEL INC" tells a reader which wire it was and
    // nothing about what it was for. What the desk decided — the head it went
    // to, and the account it moved through — is the part the ledger needs, so it
    // goes first and the bank's string is kept after it as the source, never
    // instead of it.
    // The stored answer wins where the caller passes nothing, so a line
    // re-posted later keeps the qualifier it was answered with.
    const sub = (subAccount ?? (l.sub_account as string | null) ?? "") || null;
    const bankNarration = lineNarration({
      who: accountChoice,
      what: debit > 0 ? "paid from the bank" : "received into the bank",
      subAccount: sub,
      docNo: String(l.ref ?? "") || null, docLabel: "bank ref",
      docDate: String(l.line_date),
      extra: `bank statement: ${String(l.narration ?? "").slice(0, 220)}`,
    });

    // AN EXPENSE IS ONLY ONE OF THE THINGS MONEY LEAVING A BANK CAN BE.
    //
    // Money out was always posted as a Zoho Expense, and Zoho only accepts an
    // Expense against an expense-type account. So choosing "Drawings" — which
    // is EQUITY, money the owner took out and not a cost of the business at
    // all — was refused, and there was no way to book it. The same would have
    // been true of a loan repayment (liability) or buying an asset.
    //
    // Money out to anything that is not an expense head is a journal:
    // Dr that account, Cr the bank. Which is what it always was in double
    // entry; only the Zoho document type was wrong.
    const asExpense = debit > 0 && EXPENSE_TYPES.has(other.type);

    let zohoId = "";
    if (asExpense) {
      const r = await zohoFetch<{ expense?: { expense_id: string } }>("/expenses", {
        method: "POST",
        body: {
          account_id: otherId,
          paid_through_account_id: bankId,
          date: l.line_date,
          amount: debit,
          description: bankNarration,
          ...(refNo ? { reference_number: refNo } : {}),
        },
      });
      if (!r.expense?.expense_id) return fail("Zoho did not return the created expense");
      zohoId = r.expense.expense_id;
    } else {
      // Money OUT to a non-expense head: Dr that account, Cr the bank.
      // Money IN: Dr the bank, Cr that account. One journal shape, both ways.
      const amount = debit > 0 ? debit : credit;
      const lines = debit > 0
        ? [
            { account_id: otherId, debit_or_credit: "debit", amount, description: bankNarration },
            { account_id: bankId, debit_or_credit: "credit", amount, description: bankNarration },
          ]
        : [
            { account_id: bankId, debit_or_credit: "debit", amount, description: bankNarration },
            { account_id: otherId, debit_or_credit: "credit", amount, description: bankNarration },
          ];
      const r = await zohoFetch<{ journal?: { journal_id: string } }>("/journals", {
        method: "POST",
        body: {
          journal_date: l.line_date,
          reference_number: refNo || undefined,
          notes: bankNarration,
          line_items: lines,
        },
      });
      if (!r.journal?.journal_id) return fail("Zoho did not return the created journal");
      zohoId = r.journal.journal_id;
    }
    const paper = await attachStatement(svc, l, asExpense ? "expense" : "journal", zohoId);
    await svc.from("bank_lines").update({
      status: "posted", zoho_id: zohoId, error: paper,
      proposal: { ...(l.proposal as Record<string, unknown> ?? {}), account: accountChoice },
      updated_at: new Date().toISOString(),
    }).eq("id", lineId);
  } catch (e) {
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}

/**
 * ASK ZOHO AGAIN ABOUT THE LINES STILL WAITING.
 *
 * Matching happens when a statement is ingested, which is the wrong moment for
 * half of it: he posts things in Zoho afterwards — the Razorpay clearing
 * button, an entry typed in by hand — and the portal goes on asking about
 * money that is already in the books, because nothing ever looks again.
 *
 * This re-checks every line still marked `ask` or `auto` against the account's
 * own Zoho register and against the settlements we have posted. It only ever
 * moves a line TO matched; it never un-matches, never posts, and never touches
 * a line he has already answered.
 */
export async function rematchWaitingLines(): Promise<string> {
  const svc = createServiceClient();
  const { data: waiting } = await svc
    .from("bank_lines")
    .select("id, account_name, line_date, narration, debit, credit")
    .in("status", ["ask", "auto"])
    .order("line_date");

  const rows = waiting ?? [];
  if (!rows.length) return "Nothing is waiting to be answered.";

  const { data: settleRows } = await svc
    .from("zoho_settlements").select("settlement_id, settled_on, net_inr, status")
    .in("status", ["posted", "matched"]);
  const settleByAmt = new Map<string, string>();
  for (const r of settleRows ?? []) {
    const d = String((r as { settled_on?: string }).settled_on ?? "").slice(0, 10);
    const a = Number((r as { net_inr?: number }).net_inr ?? 0);
    if (d && a > 0) settleByAmt.set(`${d}|${a.toFixed(2)}`, String(r.settlement_id));
  }

  // One register read per bank account, over the span its waiting lines cover.
  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = String(r.account_name);
    byAccount.set(k, [...(byAccount.get(k) ?? []), r]);
  }

  let matched = 0;
  const claimed = new Set<string>();
  for (const [account, list] of byAccount) {
    const dates = list.map((r) => String(r.line_date)).sort();
    const txns = await fetchZohoBankTxnsFor(account, dates[0], dates[dates.length - 1]);
    for (const l of list) {
      const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0;
      const date = String(l.line_date);
      let note: string | null = null;
      let zid: string | null = null;

      if (credit > 0 && settleByAmt.get(`${date}|${credit.toFixed(2)}`)) {
        note = "Razorpay settlement (already posted)";
      }
      if (!note) {
        const dir = debit > 0 ? "out" : "in";
        const amt = (debit > 0 ? debit : credit).toFixed(2);
        const t = txns.get(`${date}|${amt}|${dir}`)?.find((x) => !claimed.has(x.id));
        if (t) {
          claimed.add(t.id);
          zid = t.id;
          note = `already in Zoho — ${t.type}${t.note ? ` (${t.note})` : ""}`;
        }
      }
      if (note) {
        await svc.from("bank_lines").update({
          status: "matched", zoho_id: zid, error: note, updated_at: new Date().toISOString(),
        }).eq("id", l.id);
        matched++;
      }
    }
  }
  return matched
    ? `${matched} of ${rows.length} waiting line(s) are already in Zoho and will not be asked again.`
    : `Checked ${rows.length} waiting line(s) — none of them is in Zoho yet.`;
}

/** Save a taught rule and re-file any waiting ask-lines it now covers. */
export async function saveMerchantRule(pattern: string, accountName: string, subAccount?: string | null): Promise<number> {
  const svc = createServiceClient();
  const pat = pattern.trim();
  if (pat.length < 3) return 0;
  const { data: rule } = await svc.from("merchant_rules").insert({ pattern: pat, account_name: accountName, sub_account: (subAccount ?? "") || null }).select("id").single();
  const { data: waiting } = await svc.from("bank_lines").select("id, narration, debit").eq("status", "ask");
  let n = 0;
  for (const w of waiting ?? []) {
    if (String(w.narration).toUpperCase().includes(pat.toUpperCase())) {
      await svc.from("bank_lines").update({
        status: "auto",
        proposal: { account: accountName, subAccount: (subAccount ?? "") || null, kind: Number(w.debit) > 0 ? "expense" : "journal", ruleId: rule?.id },
        sub_account: (subAccount ?? "") || null,
        updated_at: new Date().toISOString(),
      }).eq("id", w.id);
      n++;
    }
  }
  return n;
}

// ---- account lists for the UI (cached — 3 Zoho calls per 10 minutes max) ----
let acctList: { names: { name: string; type: string; currency: string }[]; at: number } | null = null;
export async function listZohoAccounts(): Promise<{ name: string; type: string; currency: string }[]> {
  if (acctList && Date.now() - acctList.at < 10 * 60_000) return acctList.names;
  const names: { name: string; type: string; currency: string }[] = [];
  // TWO ZOHO QUIRKS, BOTH OF WHICH QUIETLY LOSE ACCOUNTS.
  //
  // 1. "AccountType.Active" sounds like active accounts and is not: under it
  //    Zoho returns not one expense head — no expense, no other_expense, no
  //    cost of goods sold. AccountType.All returns them.
  //
  // 2. has_more_page LIES. Page 2 comes back with 175 rows and has_more_page
  //    false, and page 3 then hands over another 131 — which happen to be every
  //    expense account in the chart. So the flag is not trusted: pages are read
  //    until one comes back EMPTY.
  //
  // Between them the hub had been running on 376 of 531 accounts, missing
  // exactly the shelf an invoice needs, which is why the team's own "Web
  // Maintainence Expenses" could never be picked from a list.
  const seen = new Set<string>();
  for (let page = 1; page <= 8; page++) {
    const r = await zohoFetch<{ chartofaccounts?: { account_name: string; account_type: string; currency_code?: string }[] }>(
      "/chartofaccounts", { query: { filter_by: "AccountType.All", per_page: "200", page: String(page) } });
    const batch = r.chartofaccounts ?? [];
    if (batch.length === 0) break;
    for (const a of batch) {
      if (seen.has(a.account_name)) continue;
      seen.add(a.account_name);
      names.push({ name: a.account_name, type: a.account_type, currency: a.currency_code || "INR" });
    }
  }
  acctList = { names, at: Date.now() };
  return names;
}
