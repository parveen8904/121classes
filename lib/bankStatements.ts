import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { resolveFileUrl, isSecureRef } from "@/lib/storage";
import { zohoReference } from "@/lib/zohoReference";
import { pairLines, type Pairing, type StatementSide, type ZohoSide } from "@/lib/reconcile";

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

// The row parser lives on its own so it can be run by a test — see
// lib/bankStatementRows.ts. Re-exported here because callers and the existing
// tests know these names at this address.
export { parseIndianDate, rowsToLines, type StmtLine } from "@/lib/bankStatementRows";
import { str, num, parseIndianDate, rowsToLines, csvToRows, type StmtLine } from "@/lib/bankStatementRows";

// ---- ingestion --------------------------------------------------------------

async function fetchFile(fileUrl: string): Promise<{ buf: ArrayBuffer } | null> {
  const target = isSecureRef(fileUrl) ? await resolveFileUrl(fileUrl, 120) : fileUrl;
  if (!target) return null;
  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) return null;
  return { buf: await res.arrayBuffer() };
}

/**
 * Parse an uploaded statement, reconcile it against Zoho, and file every line into its
 * queue. Returns a human summary for the banner.
 */

/** What the model returns → statement lines, with anything unusable dropped. */
function aiToLines(rows: { date: string; narration?: string; ref?: string; debit?: number; credit?: number; balance?: number | null }[]): StmtLine[] {
  return rows.map((l) => ({
    date: parseIndianDate(String(l.date)) || str(l.date),
    narration: str(l.narration), ref: str(l.ref),
    debit: Math.abs(Number(l.debit) || 0), credit: Math.abs(Number(l.credit) || 0),
    balance: l.balance !== undefined && l.balance !== null ? Number(l.balance) : null,
  })).filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && (l.debit || l.credit));
}

export async function ingestStatement(
  accountName: string, fileUrl: string, fileName: string,
  // Never stored. It travels with the one request that needs it and is gone —
  // a bank statement password is a credential, not a setting.
  opts?: { pdfPassword?: string },
): Promise<string> {
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
    // THREE READERS, IN ORDER OF HOW SURE EACH ONE IS.
    //
    // His uploads of 2 September failed, and once the error messages stopped
    // guessing they showed three different problems, not one:
    //
    //   · the Axis 8882 card yielded 488 characters — the name and address
    //     block — and nothing else
    //   · the NRE statement's two pages carry no text at all
    //   · the NRO one had never been retried since the fix
    //
    // Some banks draw the transaction table as a picture. No amount of parsing
    // helps with that, so there is a third reader now, and the order matters:
    //
    //   1. THE TABLE. Every fragment in a PDF carries an x and a y, so the
    //      columns can be rebuilt and fed to the same parser the Excel files
    //      use (lib/pdfTable.ts). Code, no model, exactly reproducible.
    //   2. THE TEXT. Where the layout defeats the rebuild, the text still says
    //      what happened, and the model transcribes it.
    //   3. THE PAGES. Where there is no text at all, the PDF goes to the model
    //      as a document and is read page by page. Most expensive, least
    //      certain, and last — but it is the only thing that reads a scan.
    const { readPdfRows, readPdf, readPdfBase64, readPdfPageImages } = await import("@/lib/pdf");
    const { parseBankStatementText, parseBankStatementFile, aiConfigured, aiFeatureDisabled } = await import("@/lib/ai");
    const why: string[] = [];

    const table = await readPdfRows(fileUrl, { password: opts?.pdfPassword });
    if (table.ok) {
      const r = rowsToLines(table.rows);
      lines = r.lines;
      if (!lines.length) why.push(`the table could not be rebuilt from the page (${r.note || "no header row found"})`);
    } else {
      why.push(table.reason);
    }

    const encrypted = !table.ok && !!table.needsPassword;
    let text = "";
    if (!lines.length && !encrypted) {
      const read = await readPdf(fileUrl, { password: opts?.pdfPassword });
      if (read.ok) {
        text = read.text;
        const ai = await parseBankStatementText(text);
        if (ai?.length) lines = aiToLines(ai);
        else why.push(`its text (${text.length} chars) gave no transactions`);
      } else if (!why.includes(read.reason)) {
        why.push(read.reason);
      }
    }

    // 3. THE PAGES.
    //
    // A LOCKED FILE CANNOT BE HANDED TO THE MODEL — it would meet the same lock
    // the password got us past — and that is where this stopped on 2 September,
    // telling him to "save an unlocked copy and upload again". That is the
    // portal asking him to do its job, which is the thing he had already
    // objected to.
    //
    // pdf.js decrypts as it reads, so the pages can be lifted OUT as pictures
    // and sent as pictures. An unlocked PDF still goes whole, which is better —
    // the model gets the text layer as well as the page — but a locked one is
    // no longer a dead end.
    if (!lines.length) {
      const locked = encrypted || !!opts?.pdfPassword;
      if (!locked) {
        const file = await readPdfBase64(fileUrl);
        if (!file.ok) why.push(file.reason);
        else {
          const seen = await parseBankStatementFile(file.b64);
          if (seen?.length) lines = aiToLines(seen);
        }
      }
      if (!lines.length) {
        const pages = await readPdfPageImages(fileUrl, { password: opts?.pdfPassword });
        if (!pages.ok) why.push(pages.reason);
        else {
          const seen = await parseBankStatementFile(pages.images.map((i) => ({ b64: i.b64, mediaType: "image/png" })));
          if (seen?.length) lines = aiToLines(seen);
          else why.push(`reading its ${pages.images.length} page(s) as pictures found no transactions either`);
        }
      }
    }

    if (!lines.length) {
      // Name the cause the desk can act on, not merely that it did not work.
      const aiWhy = !(await aiConfigured())
        ? " The AI key is not configured, so only the code reader ran."
        : (await aiFeatureDisabled("bankstmt"))
          ? " Statement reading is switched OFF in Admin → AI training, so only the code reader ran."
          : "";
      const seen = text ? ` It starts: "${text.slice(0, 90).replace(/\s+/g, " ")}".` : "";
      note = `${why.join("; ")}.${aiWhy}${seen}`;
    }
  } else if (/\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff?)$/i.test(lower)) {
    // A PHOTOGRAPH OF A STATEMENT IS A STATEMENT.
    //
    // His point, 2 September 2026: "Just like you are checking the student
    // paper, which is so bad handwriting — you should put one method where you
    // can upload the document. You should go to the next step."
    //
    // Exactly right, and the comparison is the argument. The paper checker has
    // been reading appalling handwriting off a phone camera for months. A bank
    // statement is an easier document than a student's answer sheet, and the
    // desk was being asked to know which of five file types the portal could
    // cope with, hunt for an Excel version, and read a paragraph about why the
    // PDF was the wrong one. One box. Whatever they have.
    const { readPdfBase64 } = await import("@/lib/pdf");
    const { parseBankStatementFile } = await import("@/lib/ai");
    const media =
      /\.png$/i.test(lower) ? "image/png"
      : /\.webp$/i.test(lower) ? "image/webp"
      : /\.gif$/i.test(lower) ? "image/gif"
      : "image/jpeg";
    const file = await readPdfBase64(fileUrl);
    if (!file.ok) note = file.reason;
    else {
      const seen = await parseBankStatementFile(file.b64, media);
      if (seen?.length) lines = aiToLines(seen);
      else note = "no transactions could be read from that picture — a clearer photograph of the rows, or the file the bank gives you, will read better";
    }
  } else {
    // Anything else still gets tried as a picture rather than refused on its
    // extension — a .jfif, a screenshot saved oddly, whatever the phone called
    // it. Refusing a file for its name is exactly the ceremony being removed.
    const { readPdfBase64 } = await import("@/lib/pdf");
    const { parseBankStatementFile } = await import("@/lib/ai");
    const file = await readPdfBase64(fileUrl);
    if (file.ok) {
      const seen = await parseBankStatementFile(file.b64, "image/jpeg");
      if (seen?.length) lines = aiToLines(seen);
    }
    if (!lines.length) note = `nothing could be read from ${fileName} — a CSV, an Excel sheet, a PDF or a photograph of the rows all work`;
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

  // NO CONTINUITY CHECK. HIS INSTRUCTION, 2 SEPTEMBER 2026.
  //
  //   "why you need continuity break. I may keep on uploading any statement
  //    from any start date. You have to reconciliation and find missing
  //    entries."
  //
  // The old test compared this statement's opening balance with the closing
  // balance of the statement before it, which assumes statements arrive in an
  // unbroken chain. They do not: a fortnight is re-sent after a wrong entry is
  // deleted, a quarter is pulled to check one payment, a month is uploaded on
  // its own. Every one of those raised "⚠️ continuity break" on a perfectly
  // good file — and the warning could not name a single line either way, so
  // there was nothing to do about it but ignore it.
  //
  // What is worth knowing is the difference against the books, and that is
  // computed below from the register this function already fetches.

  // A RE-UPLOAD IS NOT A GAP. Sending the same period again is routine — a
  // mis-posted entry is deleted in Zoho and the file goes back through. Say so
  // on the row, so the desk is not hunting for a statement that was never
  // missing. The lines themselves are deduplicated a few lines below, so
  // nothing is booked twice either.
  const { data: samePeriod } = await svc.from("bank_statements")
    .select("id").eq("account_name", accountName).eq("status", "parsed")
    .eq("period_start", first.date).eq("period_end", last.date).limit(1);
  const isReupload = (samePeriod ?? []).length > 0;

  const { data: stmt } = await svc.from("bank_statements").insert({
    account_name: accountName, file_url: fileUrl, file_name: fileName,
    period_start: first.date, period_end: last.date,
    opening_balance: opening, closing_balance: closing,
    lines_total: lines.length,
    note: isReupload ? "this period was uploaded before — the lines already filed were not booked again" : null,
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

  // RECONCILE THIS PERIOD AGAINST THE BOOKS, EVERY TIME, FREE.
  //
  // zohoTxns is the account's own Zoho register for exactly these dates and it
  // is already in hand from the matching above, so the reconciliation costs
  // nothing extra. It runs over ALL the lines in the file, duplicates included:
  // a line filed by an earlier overlapping statement is still a line the bank
  // says exists, and its Zoho entry must still be claimed or the re-upload
  // would report every previously-filed entry as an orphan.
  //
  // Same pairing as the Reconcile panel — lib/reconcile.ts, one set of rules
  // with one set of tests behind it.
  const recon = pairLines(
    lines.map((l) => ({
      date: l.date, narration: l.narration,
      amount: l.debit > 0 ? l.debit : l.credit,
      dir: (l.debit > 0 ? "out" : "in") as "in" | "out",
    })),
    [...zohoTxns].flatMap(([k, txns]) => {
      const [date, amt, dir] = k.split("|");
      return txns.map((t) => ({ date, amount: Number(amt), dir: dir as "in" | "out", type: t.type, note: t.note }));
    }),
  );
  await svc.from("bank_statements").update({
    recon_missing: recon.statementOnly.length,
    recon_extra: recon.zohoOnly.length,
  }).eq("id", stmt.id);

  const found = recon.zohoOnly.length
    ? ` ${recon.zohoOnly.length} entr${recon.zohoOnly.length === 1 ? "y" : "ies"} in Zoho for these dates ${recon.zohoOnly.length === 1 ? "has" : "have"} no line in this statement — Reconcile shows which.`
    : "";
  return `${lines.length} line(s): ${matched} matched, ${auto} auto-proposed, ${ask} to answer${dup ? `, ${dup} duplicate(s) skipped` : ""}.${found}`;
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

// Zoho's own names for what a bank entry is. Where the name says which way the
// money went there is nothing to infer, so these win over debit_or_credit.
const IN_TYPES = new Set(["deposit", "customer_payment", "invoice_payment", "sales_without_invoices", "interest_income", "other_income", "transfer_fund_to"]);
const OUT_TYPES = new Set(["withdrawal", "vendor_payment", "bill_payment", "expense", "card_payment", "expense_refund", "owner_drawings", "transfer_fund_from"]);

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
        // WHICH WAY THE MONEY WENT — and this was backwards until 2 Sep 2026.
        //
        // debit_or_credit is stated from the BOOKS' side, not the bank's. The
        // bank account is an asset: a DEBIT to it is money IN, a CREDIT is
        // money OUT. The comment that used to sit here said the opposite, and
        // so did the code.
        //
        // It showed the moment reconciliation looked both ways. Every one of
        // the seven "entries in Zoho with no bank line behind it" was the
        // exact mirror of a statement line — same date, same amount, opposite
        // sign — and the totals cross-footed perfectly: statement out
        // ₹3,05,000 against "Zoho in ₹3,05,000". Cash withdrawals we had
        // posted ourselves, and therefore knew to be money OUT, were coming
        // back from Zoho classified as money in.
        //
        // transaction_type settles it where it is unambiguous, so a single
        // odd document cannot flip a line back.
        const dc = String(t.debit_or_credit ?? "").toLowerCase();
        const tt = String(t.transaction_type ?? "").toLowerCase();
        const dir: "in" | "out" =
          IN_TYPES.has(tt) ? "in"
          : OUT_TYPES.has(tt) ? "out"
          : dc === "debit" ? "in" : "out";
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE SUB-LEDGER, POSTED AS A SUB-LEDGER
   ═══════════════════════════════════════════════════════════════════════════

   His complaint, 2 September 2026: "I asked a sub ledger. It was there but
   posting was not made in sub ledger. You just posted it in the narration
   name. The account name was drawings and sub ledger name is donation."

   Exactly right, and it made the field close to useless. The answer was taken,
   stored on the line, and written into the entry's description — so a human
   reading that one entry could see "Drawings (Donation)", and nothing else
   could. The ledger itself was Drawings. Run the Drawings account in Zoho and
   the donations are indistinguishable from every other withdrawal; there is
   nothing to total, nothing to filter, nothing to report on. A qualifier that
   exists only inside a sentence is a note, not a sub-ledger.

   Zoho's chart of accounts has real sub-accounts — a child account with a
   parent_account_id, of the parent's own type. That is what the answer creates
   now, and what the entry is posted to. Drawings still totals everything
   underneath it, and Donation stands on its own.

   An existing child of that parent is always reused, so answering "Donation"
   twice does not make two of them. The name is taken as typed; if Zoho refuses
   it because some unrelated account already has that name, it is retried as
   "Parent - Child" before giving up. It never falls back to posting against
   the parent: that is the behaviour being complained about, and doing it
   silently after being asked for a sub-ledger would be worse than failing.
*/
export async function zohoSubAccount(parentName: string, subName: string): Promise<{ id: string; type: string }> {
  const parent = await zohoAccount(parentName);
  const want = subName.trim();
  if (!want) return parent;

  const key = `${parent.id}»${want.toLowerCase()}`;
  const cached = acctCache.get(key);
  if (cached) return cached;

  type Row = { account_id: string; account_name: string; account_type: string; parent_account_id?: string };
  const search = async (text: string): Promise<Row[]> => {
    const r = await zohoFetch<{ chartofaccounts?: Row[] }>(
      "/chartofaccounts", { query: { search_text: text, filter_by: "AccountType.All", per_page: "200" } });
    return r.chartofaccounts ?? [];
  };

  // Already a child of this parent? Reuse it — an exact name first, so
  // "Donation" is never satisfied by "Donation to temple".
  const found = await search(want);
  const mine = found.filter((a) => String(a.parent_account_id ?? "") === parent.id);
  const exact = mine.find((a) => a.account_name.trim().toLowerCase() === want.toLowerCase())
    ?? mine.find((a) => a.account_name.trim().toLowerCase() === `${parentName} - ${want}`.toLowerCase());
  if (exact) {
    const out = { id: exact.account_id, type: String(exact.account_type || parent.type) };
    acctCache.set(key, out);
    return out;
  }

  // Otherwise create it under the parent, in the parent's own type — a
  // sub-account of Drawings is equity, like its parent.
  let lastErr = "";
  for (const name of [want, `${parentName} - ${want}`]) {
    try {
      const made = await zohoFetch<{ chart_of_account?: { account_id: string } }>("/chartofaccounts", {
        method: "POST",
        body: { account_name: name, account_type: parent.type, parent_account_id: parent.id },
      });
      if (made.chart_of_account?.account_id) {
        const out = { id: made.chart_of_account.account_id, type: parent.type };
        acctCache.set(key, out);
        return out;
      }
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  throw new Error(`could not make "${want}" a sub-ledger of "${parentName}" in Zoho${lastErr ? ` — ${lastErr}` : ""}. Rename it and answer again; it has NOT been posted to ${parentName} on its own.`);
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
        // Rupees per unit of the document's currency — nothing for an INR bill,
        // and settleFromBank refuses a foreign one without it.
        exchangeRate: l.fx_rate === null || l.fx_rate === undefined ? null : Number(l.fx_rate),
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

    // THE SUB-LEDGER IS THE ACCOUNT THIS POSTS TO, NOT A WORD IN THE NARRATION.
    //
    // Answered "Drawings / Donation", the entry goes to Donation, which is a
    // real sub-account of Drawings in Zoho. Drawings still totals it; running
    // Donation on its own now shows something. Before this the entry went to
    // Drawings and the word "Donation" appeared only inside the description,
    // where nothing can total it — which is what he objected to.
    const subName = ((subAccount ?? (l.sub_account as string | null) ?? "") || "").trim();
    if (subName) {
      try { other = await zohoSubAccount(accountChoice, subName); }
      catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
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
    const sub = subName || null;
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

/* ═══════════════════════════════════════════════════════════════════════════
   RECONCILE ONE ACCOUNT AGAINST ZOHO
   ═══════════════════════════════════════════════════════════════════════════

   His question, 1 September 2026: "why don't you simply reconcile statements
   with Zoho books with same bank and find missing entries and suggest entries".

   The right question. The continuity check only ever compared one statement's
   opening balance with the previous one's closing — it INFERS that something is
   missing from a gap in the arithmetic, and then cannot say what. Worse, it
   reports a break when the truth is a duplicate upload, which is what happened
   here.

   The books themselves are the answer. Everything already exists to ask them:
   fetchZohoBankTxnsFor reads the account's own register from /banktransactions,
   keyed date|amount|direction, which is how a statement line is matched today.
   Nothing ever looked the OTHER way — at what Zoho holds that the statement
   does not — so a deleted or mis-entered Zoho entry was invisible.

   This does both directions and says which is which:

     IN BOTH        agreed, nothing to do
     STATEMENT ONLY the bank has it, Zoho does not — this is money that still
                    needs an entry, and it is what "suggest entries" means
     ZOHO ONLY      Zoho has it, the bank statement does not — either the
                    statement covering it was never uploaded, or the entry is
                    wrong and should not be there
*/
export type Recon = {
  account: string; from: string; to: string;
  problem?: string;
} & Pairing;

/**
 * IS THIS EXACT MOVEMENT IN ZOHO'S REGISTER FOR THIS ACCOUNT?
 *
 * Asked before a line marked "posted" is reopened. The whole risk of a re-post
 * button is booking something twice, and the one fact that settles it is
 * whether the entry is there right now.
 */
export async function zohoHasEntryFor(accountName: string, date: string, amount: number, dir: "in" | "out"): Promise<boolean> {
  const map = await fetchZohoBankTxnsFor(accountName, date, date);
  return (map.get(`${date}|${amount.toFixed(2)}|${dir}`) ?? []).length > 0;
}

export async function reconcileAccount(accountName: string, from: string, to: string): Promise<Recon> {
  const svc = createServiceClient();

  const { data: lines } = await svc.from("bank_lines")
    .select("id, line_date, narration, debit, credit, status")
    .eq("account_name", accountName)
    .gte("line_date", from).lte("line_date", to)
    .order("line_date");

  const statement: StatementSide[] = (lines ?? []).map((l) => {
    const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0;
    return {
      date: String(l.line_date),
      narration: String(l.narration ?? ""),
      amount: credit > 0 ? credit : debit,
      dir: (credit > 0 ? "in" : "out") as "in" | "out",
      lineStatus: String(l.status ?? ""),
      lineId: String(l.id),
    };
  });

  // fetchZohoBankTxnsFor already keys the register date|amount|direction, which
  // is the same key the pairing uses — so it is unpacked back into entries and
  // paired, rather than the pairing being written twice.
  const zohoMap = await fetchZohoBankTxnsFor(accountName, from, to);
  const zoho: ZohoSide[] = [];
  for (const [k, txns] of zohoMap) {
    const [date, amt, dir] = k.split("|");
    for (const t of txns) zoho.push({ date, amount: Number(amt), dir: dir as "in" | "out", type: t.type, note: t.note });
  }

  return {
    account: accountName, from, to,
    problem: zoho.length ? undefined : "Zoho returned no entries for this account and period — check the hub is connected.",
    ...pairLines(statement, zoho),
  };
}
