import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { resolveFileUrl, isSecureRef } from "@/lib/storage";

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
  const n = Number(String(v ?? "").replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
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
  date: /^(txn ?date|tran\.? ?date|transaction ?date|date|value ?date)$/i,
  narration: /^(particulars?|narration|description|details|transaction ?(details|remarks)|remarks)$/i,
  ref: /^(chq\.?\/?ref\.? ?(no\.?)?|ref(erence)? ?(no\.?)?|cheque ?no\.?|utr|chqno)$/i,
  debit: /^(withdrawal ?(amt\.?)? ?(\(?inr\)?)?|debit|dr|dr\.? ?amount|withdrawals?)$/i,
  credit: /^(deposit ?(amt\.?)? ?(\(?inr\)?)?|credit|cr|cr\.? ?amount|deposits?)$/i,
  balance: /^(closing ?balance|balance|bal|running ?balance|balance ?(\(?inr\)?)?)$/i,
  amount: /^(amount|amount ?\(?inr\)?|txn ?amount)$/i,
  drcr: /^(dr\/?cr|type|cr\/?dr)$/i,
};

export function rowsToLines(rows: string[][]): { lines: StmtLine[]; note: string } {
  // Find the header row: the first row matching a date-column AND a narration-column.
  let hi = -1; const cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i].map((c) => str(c));
    const find = (re: RegExp) => r.findIndex((c) => re.test(c));
    if (find(HEAD.date) >= 0 && find(HEAD.narration) >= 0) {
      hi = i;
      for (const [k, re] of Object.entries(HEAD)) {
        const idx = find(re);
        if (idx >= 0) cols[k] = idx;
      }
      break;
    }
  }
  if (hi < 0) return { lines: [], note: "could not find the header row (Date + Particulars)" };

  const lines: StmtLine[] = [];
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
      if (!ai) note = "the PDF could not be transcribed";
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
  const [{ data: settleRows }, rules, zohoExp] = await Promise.all([
    svc.from("zoho_settlements").select("utr, settlement_id, status").in("status", ["posted", "matched"]),
    svc.from("merchant_rules").select("id, pattern, account_name").then((r) => r.data ?? []),
    fetchZohoExpensesFor(accountName, first.date, last.date),
  ]);
  const utrs = new Map((settleRows ?? []).filter((s) => s.utr).map((s) => [String(s.utr), String(s.settlement_id)]));

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

    // 2) The office's existing Zoho expenses for this account: amount + date.
    if (status === "ask" && l.debit > 0) {
      const k = `${l.date}|${l.debit.toFixed(2)}`;
      const exp = zohoExp.get(k)?.find((e) => !usedExp.has(e.id));
      if (exp) {
        usedExp.add(exp.id);
        status = "matched"; zohoId = exp.id; matchedNote = `already entered (${exp.account})`;
      }
    }

    // 3) Merchant rules — the taught mappings.
    if (status === "ask") {
      const up = l.narration.toUpperCase();
      const rule = rules.find((r) => up.includes(String(r.pattern).toUpperCase()));
      if (rule) {
        status = "auto";
        proposal = { account: rule.account_name, kind: l.debit > 0 ? "expense" : "journal", ruleId: rule.id };
      }
    }

    await svc.from("bank_lines").insert({
      statement_id: stmt.id, account_name: accountName,
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

const acctCache = new Map<string, string>();
export async function zohoAccountId(name: string): Promise<string> {
  const hit = acctCache.get(name);
  if (hit) return hit;
  const r = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string }[] }>(
    "/chartofaccounts", { query: { search_text: name, filter_by: "AccountType.All" } });
  const found = (r.chartofaccounts ?? []).find((a) => a.account_name === name);
  if (!found) throw new Error(`Zoho account "${name}" not found`);
  acctCache.set(name, found.account_id);
  return found.account_id;
}

// ---- posting one line -------------------------------------------------------

/** Post an approved line. Debits become Expenses (the office's style: narration
 *  verbatim, paid through the bank account); credits become journals
 *  (Dr bank / Cr the chosen account). */
export async function postBankLine(lineId: string, accountChoice: string): Promise<void> {
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
    const otherId = await zohoAccountId(accountChoice);
    const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0;
    let zohoId = "";
    if (debit > 0) {
      const r = await zohoFetch<{ expense?: { expense_id: string } }>("/expenses", {
        method: "POST",
        body: {
          account_id: otherId,
          paid_through_account_id: bankId,
          date: l.line_date,
          amount: debit,
          description: String(l.narration).slice(0, 500),
          ...(l.ref ? { reference_number: String(l.ref).slice(0, 90) } : {}),
        },
      });
      if (!r.expense?.expense_id) return fail("Zoho did not return the created expense");
      zohoId = r.expense.expense_id;
    } else {
      const r = await zohoFetch<{ journal?: { journal_id: string } }>("/journals", {
        method: "POST",
        body: {
          journal_date: l.line_date,
          reference_number: String(l.ref || "").slice(0, 90) || undefined,
          notes: String(l.narration).slice(0, 500),
          line_items: [
            { account_id: bankId, debit_or_credit: "debit", amount: credit },
            { account_id: otherId, debit_or_credit: "credit", amount: credit },
          ],
        },
      });
      if (!r.journal?.journal_id) return fail("Zoho did not return the created journal");
      zohoId = r.journal.journal_id;
    }
    await svc.from("bank_lines").update({
      status: "posted", zoho_id: zohoId, error: null,
      proposal: { ...(l.proposal as Record<string, unknown> ?? {}), account: accountChoice },
      updated_at: new Date().toISOString(),
    }).eq("id", lineId);
  } catch (e) {
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}

/** Save a taught rule and re-file any waiting ask-lines it now covers. */
export async function saveMerchantRule(pattern: string, accountName: string): Promise<number> {
  const svc = createServiceClient();
  const pat = pattern.trim();
  if (pat.length < 3) return 0;
  const { data: rule } = await svc.from("merchant_rules").insert({ pattern: pat, account_name: accountName }).select("id").single();
  const { data: waiting } = await svc.from("bank_lines").select("id, narration, debit").eq("status", "ask");
  let n = 0;
  for (const w of waiting ?? []) {
    if (String(w.narration).toUpperCase().includes(pat.toUpperCase())) {
      await svc.from("bank_lines").update({
        status: "auto",
        proposal: { account: accountName, kind: Number(w.debit) > 0 ? "expense" : "journal", ruleId: rule?.id },
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
