import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { zohoAccountId, listZohoAccounts } from "@/lib/bankStatements";
import { rule115Rate } from "@/lib/forexRates";
import { resolveFileUrl, isSecureRef } from "@/lib/storage";

// Foreign-currency journals: the broker ledgers are USD-DENOMINATED in Zoho
// (the founder confirmed, and his team's card entries prove it), so journals
// post IN USD with the Rule-115 rate as the exchange rate — the ledger stays
// in dollars, the books convert.
let currencyCache: Map<string, string> | null = null;
async function currencyId(code: string): Promise<string | null> {
  if (!currencyCache) {
    const r = await zohoFetch<{ currencies?: { currency_id: string; currency_code: string }[] }>("/settings/currencies");
    currencyCache = new Map((r.currencies ?? []).map((c) => [c.currency_code, c.currency_id]));
  }
  return currencyCache.get(code) ?? null;
}
async function accountCurrency(name: string): Promise<string> {
  const hit = (await listZohoAccounts()).find((a) => a.name === name);
  return hit?.currency ?? "INR";
}

// US BROKERAGE → ZOHO, at cost, every rupee via Rule 115.
//
// A statement uploads per brokerage account. The fast model TRANSCRIBES the
// transactions; each line is converted at the Rule-115 SBI TT buying rate
// (rate + rate-date stored on the line — auditable provenance), proposed into
// the founder's own account conventions, and posts as an INR journal on
// approval:
//   dividend  Dr Brokerage / Cr Dividend-<Broker> (falls back to Dividend-US)
//   interest  Dr Brokerage / Cr Interest-<Broker>
//   fee       Dr US Bank Charges / Cr Brokerage
//   tax w/h   Dr US Tax Expenses / Cr Brokerage (account editable — policy his)
//   buy       Dr <SYM>-<Broker> / Cr Brokerage (missing scrip → "<SYM>-<Broker> (AI)")
//   sell      ASKS for the cost portion: Dr Brokerage (proceeds) /
//             Cr <scrip> (cost) / Cr-or-Dr Profit on Sale of Shares-<Broker>
// This fixes the one verified gap in the books: US dividend/interest income
// was almost entirely unentered.

const BROKER_SHORT: Record<string, string> = {
  "IBKR-Brokerage": "IBKR",
  "Fidelity Brokerage": "Fidelity",
  "Robinhood-Brokerage": "Robinhood",
  "ThinkorSwim": "ThinkorSwim",
  "Tasty Trade INC": "Tasty Trade",
};

const str = (v: unknown) => String(v ?? "").trim();

async function pickExisting(cands: string[], fallback: string): Promise<string> {
  const names = new Set((await listZohoAccounts()).map((a) => a.name));
  for (const c of cands) if (names.has(c)) return c;
  return fallback;
}

async function defaultAccountFor(kind: string, broker: string, symbol: string, accountName: string): Promise<{ account: string; side: "credit" | "debit" }> {
  // side = which leg the CHOSEN account takes; the brokerage account takes the other.
  switch (kind) {
    case "dividend":
      return { account: await pickExisting([`Dividend-${broker}`, `Dividend-Think or Swim`, "Dividend-US"], "Dividend-US"), side: "credit" };
    case "interest":
      return { account: await pickExisting([`Interest-${broker}`, `Interest-Fidelity Brokerage`, `Interest-Robinhood Operating`, "Interest Income"], "Interest Income"), side: "credit" };
    case "fee":
      return { account: await pickExisting(["US Bank Charges", "Bank Fees and Charges"], "US Bank Charges"), side: "debit" };
    case "tax":
      return { account: await pickExisting(["US Tax Expenses"], "US Tax Expenses"), side: "debit" };
    case "buy":
      return { account: symbol ? `${symbol}-${broker}` : accountName, side: "debit" };
    default:
      return { account: "", side: "debit" };
  }
}

async function fetchText(fileUrl: string, fileName: string): Promise<string | null> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const { extractPdfText } = await import("@/lib/pdf");
    return (await extractPdfText(fileUrl)) || null;
  }
  const target = isSecureRef(fileUrl) ? await resolveFileUrl(fileUrl, 120) : fileUrl;
  if (!target) return null;
  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) return null;
  return await res.text();
}

/** Parse an uploaded brokerage statement and queue its lines with Rule-115 conversion. */
export async function ingestBrokerageStatement(accountName: string, fileUrl: string, fileName: string): Promise<string> {
  const svc = createServiceClient();
  const text = await fetchText(fileUrl, fileName);
  if (!text) {
    await svc.from("brokerage_statements").insert({ account_name: accountName, file_url: fileUrl, file_name: fileName, status: "failed", note: "could not read the file (scanned images?)" });
    return "Could not read the uploaded file.";
  }
  const { parseBrokerageStatementText } = await import("@/lib/ai");
  const parsed = await parseBrokerageStatementText(text);
  const lines = (parsed ?? []).filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(str(l.date)) && Number(l.amount) > 0);
  if (!lines.length) {
    await svc.from("brokerage_statements").insert({ account_name: accountName, file_url: fileUrl, file_name: fileName, status: "failed", note: "no transactions could be transcribed" });
    return "No transactions could be read from this statement.";
  }
  lines.sort((a, b) => str(a.date).localeCompare(str(b.date)));

  const { data: stmt } = await svc.from("brokerage_statements").insert({
    account_name: accountName, file_url: fileUrl, file_name: fileName,
    period_start: lines[0].date, period_end: lines[lines.length - 1].date, lines_total: lines.length,
  }).select("id").single();
  if (!stmt) return "Could not record the statement.";

  const broker = BROKER_SHORT[accountName] ?? accountName.split(/[ -]/)[0];

  // Duplicate guard across overlapping statements for the same account.
  const { data: existing } = await svc.from("brokerage_lines")
    .select("line_date, kind, symbol, usd_amount").eq("account_name", accountName)
    .gte("line_date", lines[0].date).lte("line_date", lines[lines.length - 1].date);
  const seen = new Set((existing ?? []).map((e) => `${e.line_date}|${e.kind}|${str(e.symbol)}|${Number(e.usd_amount).toFixed(2)}`));

  let queued = 0, dup = 0;
  for (const l of lines) {
    const usd = Math.abs(Number(l.amount)) || 0;
    const key = `${l.date}|${l.kind}|${str(l.symbol).toUpperCase()}|${usd.toFixed(2)}`;
    if (seen.has(key)) { dup++; continue; }
    seen.add(key);

    // Rule 115: the SBI TT buy of the last day of the month preceding the txn month.
    let rate: number | null = null, rateDate: string | null = null;
    try {
      const r = await rule115Rate(str(l.date), "USD");
      if (r) { rate = r.rate; rateDate = r.rateDate; }
    } catch { /* line still queues; conversion retried at posting */ }

    let proposal: Record<string, unknown> | null = null;
    let status = "ask";
    // OPTIONS (the founder's own treatment, learned from his chart): premium
    // received on writing → "Option Premium Received" (income); premium paid —
    // buying or buying back — → "Option Premium Paid" (expense). An EXPIRED
    // option never appears here (no cash moves; the premium already sits in
    // the P&L). Assignments/exercises fall through to the ask queue.
    const looksOption = /\b(CALL|PUT)\b|\d{1,2}\/\d{1,2}\/\d{2,4}\s*[CP]\s*\d|OPTION/i.test(`${str(l.symbol)} ${str(l.description)}`);
    if (looksOption && (l.kind === "sell" || l.kind === "buy")) {
      proposal = l.kind === "sell"
        ? { account: "Option Premium Received", side: "credit", option: true }
        : { account: "Option Premium Paid", side: "debit", option: true };
      status = "auto";
    } else if (["dividend", "interest", "fee", "tax", "buy"].includes(l.kind)) {
      const d = await defaultAccountFor(l.kind, broker, str(l.symbol).toUpperCase(), accountName);
      if (d.account) { proposal = { account: d.account, side: d.side }; status = "auto"; }
    }
    // share sells, deposits, withdrawals, other → ask (a share sell needs its cost).

    await svc.from("brokerage_lines").insert({
      statement_id: stmt.id, account_name: accountName,
      line_date: l.date, kind: l.kind, symbol: str(l.symbol).toUpperCase() || null,
      qty: l.qty ?? null, price_usd: l.price ?? null,
      usd_amount: usd, rate, rate_date: rateDate,
      inr_amount: rate ? Number((usd * rate).toFixed(2)) : null,
      description: str(l.description).slice(0, 300),
      status, proposal,
    });
    queued++;
  }
  return `${queued} transaction(s) queued (${dup} duplicate(s) skipped). Dividends/interest/fees/buys are pre-proposed; sells ask for their cost.`;
}

async function ensureScripAccount(name: string): Promise<string> {
  const names = new Set((await listZohoAccounts()).map((a) => a.name));
  if (names.has(name)) return name;
  const aiName = `${name} (AI)`;
  if (names.has(aiName)) return aiName;
  await zohoFetch("/chartofaccounts", { method: "POST", body: { account_name: aiName, account_type: "other_current_asset" } });
  return aiName;
}

/** Post one approved brokerage line as an INR journal (Rule-115 converted). */
export async function postBrokerageLine(
  lineId: string,
  opts: { account?: string; costUsd?: number; plAccount?: string } = {},
): Promise<void> {
  const svc = createServiceClient();
  const { data: l } = await svc.from("brokerage_lines").select("*").eq("id", lineId).maybeSingle();
  if (!l) throw new Error("line not found");
  if (l.status === "posted") return;

  const fail = async (msg: string) => {
    await svc.from("brokerage_lines").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", lineId);
    throw new Error(msg);
  };

  try {
    // Conversion must exist before anything posts.
    let rate = l.rate ? Number(l.rate) : null, rateDate = l.rate_date as string | null;
    if (!rate) {
      const r = await rule115Rate(String(l.line_date), "USD");
      if (!r) return fail("no Rule-115 rate available for this date yet");
      rate = r.rate; rateDate = r.rateDate;
    }
    const usd = Number(l.usd_amount);
    const inr = Number((usd * rate).toFixed(2));
    const brokerId = await zohoAccountId(String(l.account_name));
    // FCY: broker ledgers are USD accounts → the journal is a USD journal at
    // the Rule-115 rate. (If ever an INR broker account appears, amounts fall
    // back to INR with no journal currency.)
    const acctCur = await accountCurrency(String(l.account_name));
    const usdId = acctCur === "USD" ? await currencyId("USD") : null;
    const amt = (v: number) => (usdId ? Number(v.toFixed(2)) : Number((v * rate!).toFixed(2)));
    const refNo = `BRK-${String(l.id).slice(0, 8)}`;
    const notes = `${String(l.kind).toUpperCase()}${l.symbol ? ` ${l.symbol}` : ""} — $${Number(l.usd_amount).toFixed(2)} @ ₹${rate} (SBI TT buy ${rateDate}, Rule 115) — ${String(l.description ?? "")}`.slice(0, 480);

    let lineItems: { account_id: string; debit_or_credit: "debit" | "credit"; amount: number }[] = [];

    if (l.kind === "sell") {
      const cost = Number(opts.costUsd) || 0;
      if (cost <= 0) return fail("a sell needs its USD cost to remove from the scrip account");
      if (!l.symbol) return fail("a sell needs its symbol");
      const broker = BROKER_SHORT[String(l.account_name)] ?? String(l.account_name).split(/[ -]/)[0];
      const scrip = await ensureScripAccount(`${l.symbol}-${broker}`);
      const plName = opts.plAccount || `Profit on Sale of Shares-${broker}`;
      const plAcct = await zohoAccountId(await (async () => {
        const names = new Set((await listZohoAccounts()).map((a) => a.name));
        return names.has(plName) ? plName : "Profit on Sale of Shares";
      })());
      const scripId = await zohoAccountId(scrip);
      const diff = Number((usd - cost).toFixed(2));
      lineItems = [
        { account_id: brokerId, debit_or_credit: "debit", amount: amt(usd) },
        { account_id: scripId, debit_or_credit: "credit", amount: amt(cost) },
        ...(diff > 0 ? [{ account_id: plAcct, debit_or_credit: "credit" as const, amount: amt(diff) }]
          : diff < 0 ? [{ account_id: plAcct, debit_or_credit: "debit" as const, amount: amt(Math.abs(diff)) }] : []),
      ];
    } else {
      const account = str(opts.account || (l.proposal as { account?: string } | null)?.account);
      if (!account) return fail("pick the account for this line");
      const side = str((l.proposal as { side?: string } | null)?.side) === "credit" || ["dividend", "interest", "deposit"].includes(String(l.kind))
        ? "credit" : "debit";
      const otherId = l.kind === "buy" ? await zohoAccountId(await ensureScripAccount(account)) : await zohoAccountId(account);
      lineItems = side === "credit"
        ? [ // money INTO the brokerage: Dr broker / Cr chosen (income, transfer source)
            { account_id: brokerId, debit_or_credit: "debit", amount: amt(usd) },
            { account_id: otherId, debit_or_credit: "credit", amount: amt(usd) },
          ]
        : [ // money OUT of the brokerage: Dr chosen (expense, scrip, transfer dest) / Cr broker
            { account_id: otherId, debit_or_credit: "debit", amount: amt(usd) },
            { account_id: brokerId, debit_or_credit: "credit", amount: amt(usd) },
          ];
    }

    const j = await zohoFetch<{ journal?: { journal_id: string } }>("/journals", {
      method: "POST",
      body: {
        journal_date: l.line_date, reference_number: refNo, notes, line_items: lineItems,
        ...(usdId ? { currency_id: usdId, exchange_rate: rate } : {}),
      },
    });
    if (!j.journal?.journal_id) return fail("Zoho did not return the created journal");
    await svc.from("brokerage_lines").update({
      status: "posted", zoho_id: j.journal.journal_id, rate, rate_date: rateDate, inr_amount: inr,
      proposal: { ...(l.proposal as Record<string, unknown> ?? {}), ...opts },
      error: null, updated_at: new Date().toISOString(),
    }).eq("id", lineId);
  } catch (e) {
    if (e instanceof Error && /needs its|pick the/.test(e.message)) throw e;
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}
