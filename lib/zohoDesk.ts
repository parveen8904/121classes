import { createServiceClient } from "@/lib/supabase/service";
import { listZohoAccounts } from "@/lib/bankStatements";

// PRADEEP'S BACKLOG + THE DESK-WIDE SEARCH.
//
// Backlog: pick an as-of date and see exactly what stands between the books
// and completeness up to that date — statement coverage gaps per account,
// and every queue item still waiting. Change the date, the backlog changes.
//
// Search: one box over every desk (sales, settlements, bank lines, brokerage,
// petty bills), filterable by date range and part — the reconciliation view.

const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export type BacklogItem = { part: string; task: string; count?: number; anchor: string };

export async function backlogItems(uptoISO: string): Promise<{ items: BacklogItem[]; neverUploaded: string[] }> {
  const svc = createServiceClient();
  const upto = day(uptoISO) || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const items: BacklogItem[] = [];

  // Statement coverage per bank/card account.
  let accounts: { name: string; type: string }[] = [];
  try { accounts = await listZohoAccounts(); } catch { /* coverage checks skipped */ }
  const bankish = accounts.filter((a) => a.type === "bank" || a.type === "credit_card");
  const brokerish = bankish.filter((a) => /brokerage|thinkorswim|tasty/i.test(a.name));
  const pureBank = bankish.filter((a) => !brokerish.includes(a));

  const { data: stmtCover } = await svc.from("bank_statements")
    .select("account_name, period_end").eq("status", "parsed").order("period_end", { ascending: false });
  const lastBy = new Map<string, string>();
  for (const s of stmtCover ?? []) if (!lastBy.has(s.account_name)) lastBy.set(s.account_name, s.period_end);

  const { data: brokCover } = await svc.from("brokerage_statements")
    .select("account_name, period_end").eq("status", "parsed").order("period_end", { ascending: false });
  const brokLastBy = new Map<string, string>();
  for (const s of brokCover ?? []) if (!brokLastBy.has(s.account_name)) brokLastBy.set(s.account_name, s.period_end);

  const neverUploaded: string[] = [];
  for (const a of pureBank) {
    const last = lastBy.get(a.name);
    if (!last) { neverUploaded.push(a.name); continue; }
    if (last < upto) items.push({ part: "Bank statements", task: `${a.name}: upload ${nextDay(last)} → ${upto}`, anchor: "#bank" });
  }
  for (const a of brokerish) {
    const last = brokLastBy.get(a.name);
    if (!last) { neverUploaded.push(a.name); continue; }
    if (last < upto) items.push({ part: "Brokerage", task: `${a.name}: upload ${nextDay(last)} → ${upto}`, anchor: "#brokerage" });
  }

  // Queue items waiting, dated up to the as-of date.
  const counts = await Promise.all([
    svc.from("zoho_postings").select("id", { count: "exact", head: true }).in("status", ["draft", "needs_info", "failed"]),
    svc.from("zoho_settlements").select("id", { count: "exact", head: true }).in("status", ["draft", "failed"]).lte("settled_on", upto),
    svc.from("bank_lines").select("id", { count: "exact", head: true }).in("status", ["ask", "auto", "failed"]).lte("line_date", upto),
    svc.from("brokerage_lines").select("id", { count: "exact", head: true }).in("status", ["ask", "auto", "failed"]).lte("line_date", upto),
    svc.from("petty_bills").select("id", { count: "exact", head: true }).in("status", ["pending", "failed"]).lte("bill_date", upto),
  ]);
  const [sales, settle, bank, brok, petty] = counts.map((c) => c.count ?? 0);

  // SCHEDULED COMPLIANCE PULLS — 26AS + AIS/TIS, quarterly (agreed 23 Aug).
  // A window's task appears once its date arrives and clears only when a vault
  // document of that type, uploaded on/after the window opened, exists.
  // Windows follow the TDS-filing calendar: Q1 credits land after 31 Jul (pull
  // from 10 Aug), Q2 after 31 Oct (15 Nov), Q3 after 31 Jan (15 Feb), and the
  // AUTHORITATIVE pull after Q4 TDS + 31-May SFT filings (15 Jun).
  const fyStartYear = Number(upto.slice(0, 4)) - (Number(upto.slice(5, 7)) < 4 ? 1 : 0);
  const fyLabel = `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
  const pullWindows = [
    { start: `${fyStartYear}-08-10`, label: `Q1 pull (${fyLabel})` },
    { start: `${fyStartYear}-11-15`, label: `Q2 pull (${fyLabel})` },
    { start: `${fyStartYear + 1}-02-15`, label: `Q3 pull (${fyLabel})` },
    { start: `${fyStartYear + 1}-06-15`, label: `FINAL pre-ITR pull (${fyLabel})` },
  ].filter((w) => w.start <= upto);
  if (pullWindows.length) {
    const { data: taxDocs } = await svc.from("zoho_vault_docs")
      .select("doc_type, created_at").in("doc_type", ["26AS", "AIS / TIS"]);
    const doneAfter = (type: string, start: string) =>
      (taxDocs ?? []).some((d) => d.doc_type === type && String(d.created_at).slice(0, 10) >= start);
    for (const w of pullWindows) {
      if (!doneAfter("26AS", w.start)) {
        items.push({ part: "Tax forms", task: `26AS — ${w.label}: download from the e-filing portal and file in the vault`, anchor: "#vault" });
      }
      if (!doneAfter("AIS / TIS", w.start)) {
        items.push({ part: "Tax forms", task: `AIS + TIS — ${w.label}: download and file in the vault`, anchor: "#vault" });
      }
    }
  }
  if (sales) items.push({ part: "Sales → Zoho", task: "sales waiting for approval / attention", count: sales, anchor: "#queue" });
  if (settle) items.push({ part: "Settlements", task: "settlements to approve", count: settle, anchor: "#settlements" });
  if (bank) items.push({ part: "Bank lines", task: "statement lines to answer / approve", count: bank, anchor: "#bank" });
  if (brok) items.push({ part: "Brokerage", task: "brokerage lines to answer / approve", count: brok, anchor: "#brokerage" });
  if (petty) items.push({ part: "Petty cash", task: "bills waiting for approval", count: petty, anchor: "#petty" });

  return { items, neverUploaded };
}

export type SearchRow = {
  date: string; part: string; label: string; amount: number | null; status: string; ref: string | null;
};

export async function searchDesk(p: { q?: string; from?: string; to?: string; part?: string }): Promise<SearchRow[]> {
  const svc = createServiceClient();
  const q = (p.q ?? "").trim();
  const from = day(p.from), to = day(p.to);
  const part = p.part || "all";
  const want = (x: string) => part === "all" || part === x;
  const rows: SearchRow[] = [];
  const like = `%${q.replace(/[%_]/g, "")}%`;

  if (want("sales")) {
    let qy = svc.from("zoho_postings").select("order_no, status, payload, zoho_invoice_number").limit(100);
    const { data } = await qy;
    for (const r of data ?? []) {
      const pl = r.payload as { customer?: string; amountInr?: number; date?: string; description?: string; invoiceNo?: string };
      const hay = `${r.order_no} ${pl.customer} ${pl.description} ${pl.invoiceNo} ${r.zoho_invoice_number}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) continue;
      const d = pl.date ?? "";
      if (from && d < from) continue;
      if (to && d > to) continue;
      rows.push({ date: d, part: "Sales", label: `#${r.order_no} · ${pl.customer} · ${pl.description}`, amount: pl.amountInr ?? null, status: r.status, ref: r.zoho_invoice_number ?? pl.invoiceNo ?? null });
    }
  }
  if (want("settlements")) {
    let qy = svc.from("zoho_settlements").select("settled_on, net_inr, gross_inr, status, utr, settlement_id").limit(200);
    if (from) qy = qy.gte("settled_on", from);
    if (to) qy = qy.lte("settled_on", to);
    const { data } = await qy;
    for (const r of data ?? []) {
      const hay = `${r.utr} ${r.settlement_id}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) continue;
      rows.push({ date: r.settled_on, part: "Settlement", label: `UTR ${r.utr ?? "—"} · gross ₹${Number(r.gross_inr).toFixed(0)}`, amount: Number(r.net_inr), status: r.status, ref: r.settlement_id });
    }
  }
  if (want("bank")) {
    let qy = svc.from("bank_lines").select("line_date, account_name, narration, debit, credit, status, ref").limit(300).order("line_date", { ascending: false });
    if (from) qy = qy.gte("line_date", from);
    if (to) qy = qy.lte("line_date", to);
    if (q) qy = qy.or(`narration.ilike.${like},ref.ilike.${like},account_name.ilike.${like}`);
    const { data } = await qy;
    for (const r of data ?? []) {
      rows.push({ date: r.line_date, part: "Bank", label: `${r.account_name} · ${String(r.narration).slice(0, 90)}`, amount: Number(r.debit) > 0 ? -Number(r.debit) : Number(r.credit), status: r.status, ref: r.ref });
    }
  }
  if (want("brokerage")) {
    let qy = svc.from("brokerage_lines").select("line_date, account_name, kind, symbol, usd_amount, inr_amount, status, description").limit(300).order("line_date", { ascending: false });
    if (from) qy = qy.gte("line_date", from);
    if (to) qy = qy.lte("line_date", to);
    if (q) qy = qy.or(`description.ilike.${like},symbol.ilike.${like},account_name.ilike.${like},kind.ilike.${like}`);
    const { data } = await qy;
    for (const r of data ?? []) {
      rows.push({ date: r.line_date, part: "Brokerage", label: `${r.account_name} · ${r.kind}${r.symbol ? ` ${r.symbol}` : ""} · $${Number(r.usd_amount).toFixed(2)}`, amount: r.inr_amount !== null ? Number(r.inr_amount) : null, status: r.status, ref: null });
    }
  }
  if (want("petty")) {
    let qy = svc.from("petty_bills").select("bill_date, amount, purpose, status, person:person_id(name)").limit(200).order("bill_date", { ascending: false });
    if (from) qy = qy.gte("bill_date", from);
    if (to) qy = qy.lte("bill_date", to);
    if (q) qy = qy.ilike("purpose", like);
    const { data } = await qy;
    for (const r of data ?? []) {
      const person = r.person as unknown as { name?: string } | null;
      rows.push({ date: r.bill_date, part: "Petty", label: `${person?.name ?? "?"} · ${r.purpose}`, amount: Number(r.amount), status: r.status, ref: null });
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows.slice(0, 300);
}
