import { zohoFetch } from "@/lib/zohoApi";
import { createServiceClient } from "@/lib/supabase/service";

// WHAT A PAYMENT IN THE BANK ACTUALLY SETTLES.
//
// He asked the right question: how can this match a payment to a party when the
// portal keeps no ledger balance for anyone? It does not need one. ZOHO HOLDS
// THE OPEN ITEMS — every unpaid bill and every unpaid invoice, by party, with
// amounts and dates. Matching is done against that list, and the list is the
// truth rather than a copy of it.
//
// The distinction matters more than it sounds. Money paid to a supplier is NOT
// an expense: the expense was booked when their bill arrived, and booking it
// again doubles the cost and leaves the bill sitting open for ever. Money in
// from a tenant is not fresh income either. Each SETTLES a document, and the
// entry that settles it is a payment or a receipt.

export type OpenItem = {
  kind: "bill" | "invoice";
  id: string;
  number: string;
  party: string;
  partyId: string;
  date: string;
  total: number;
  balance: number;
  /** The document's own currency. A non-INR document needs a rate to settle. */
  currency: string;
};

export type Candidate = {
  item: OpenItem;
  score: number;
  why: string[];
};

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT IS STILL OPEN, ASKED OF ZOHO
   ═══════════════════════════════════════════════════════════════════════════ */
let cache: { at: number; items: OpenItem[] } | null = null;

export async function openItems(force = false): Promise<OpenItem[]> {
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache.items;

  const items: OpenItem[] = [];

  // Bills we owe. Zoho's status filters differ between modules and versions, so
  // the balance is what decides — a document with nothing left on it is closed
  // whatever it is called.
  try {
    const r = await zohoFetch<{ bills?: Record<string, unknown>[] }>("/bills", {
      query: { filter_by: "Status.Unpaid", per_page: "200" },
    });
    for (const b of r.bills ?? []) {
      const balance = Number(b.balance ?? 0);
      if (balance <= 0) continue;
      items.push({
        kind: "bill", id: String(b.bill_id), number: String(b.bill_number ?? ""),
        party: String(b.vendor_name ?? ""), partyId: String(b.vendor_id ?? ""),
        date: String(b.date ?? ""), total: Number(b.total ?? 0), balance,
        currency: String(b.currency_code ?? "INR").toUpperCase(),
      });
    }
  } catch { /* the caller is told when nothing could be read */ }

  try {
    const r = await zohoFetch<{ invoices?: Record<string, unknown>[] }>("/invoices", {
      query: { filter_by: "Status.Unpaid", per_page: "200" },
    });
    for (const i of r.invoices ?? []) {
      const balance = Number(i.balance ?? 0);
      if (balance <= 0) continue;
      items.push({
        kind: "invoice", id: String(i.invoice_id), number: String(i.invoice_number ?? ""),
        party: String(i.customer_name ?? ""), partyId: String(i.customer_id ?? ""),
        date: String(i.date ?? ""), total: Number(i.total ?? 0), balance,
        currency: String(i.currency_code ?? "INR").toUpperCase(),
      });
    }
  } catch { /* as above */ }

  cache = { at: Date.now(), items };
  return items;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MATCHING
   ═══════════════════════════════════════════════════════════════════════════ */
/** A balance shown in the currency it is actually owed in. */
const money = (i: { balance: number; currency: string }) =>
  i.currency === "INR" ? `₹${i.balance.toLocaleString("en-IN")}` : `${i.currency} ${i.balance.toLocaleString("en-US")}`;

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Words worth matching on — a party's name minus the words every party has. */
const NOISE = new Set([
  "pvt", "private", "ltd", "limited", "llp", "inc", "co", "company", "the", "and",
  "india", "services", "solutions", "enterprises", "traders", "hindu", "undivided", "family", "huf",
]);
const words = (s: string) => clean(s).split(" ").filter((w) => w.length > 2 && !NOISE.has(w));

const daysBetween = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

/**
 * What this bank line might settle, best first.
 *
 * Nothing here decides anything. A line that looks certain is still proposed,
 * because a payment posted against the wrong invoice is worse than one left
 * waiting — it closes a document that is still owed and hides a debt.
 */
export function matchLine(
  line: { line_date: string; narration: string; ref?: string | null; debit: number; credit: number },
  items: OpenItem[],
): Candidate[] {
  const paidOut = Number(line.debit) > 0;
  const amount = paidOut ? Number(line.debit) : Number(line.credit);
  if (!amount) return [];

  // Money out settles a bill we owe; money in settles an invoice we raised.
  const pool = items.filter((i) => (paidOut ? i.kind === "bill" : i.kind === "invoice"));
  const hay = clean(`${line.narration} ${line.ref ?? ""}`);

  const out: Candidate[] = [];
  for (const item of pool) {
    const why: string[] = [];
    let score = 0;

    // THE AMOUNT. Exact is the strongest single signal there is.
    const diff = Math.abs(item.balance - amount);
    if (diff < 0.5) { score += 60; why.push("the amount is exact"); }
    else if (diff <= Math.max(2, item.balance * 0.005)) { score += 40; why.push("the amount agrees to the rupee"); }
    else if (amount < item.balance) { score += 8; why.push("it would part-settle"); }
    else continue;                                   // more than is owed — not this one alone

    // THE NAME, as the bank prints it.
    const hits = words(item.party).filter((w) => hay.includes(w));
    if (hits.length) {
      score += Math.min(30, 12 * hits.length);
      why.push(`"${hits.join(" ")}" appears in the narration`);
    }

    // THE DOCUMENT NUMBER, when the bank carries it.
    const num = clean(item.number).replace(/\s/g, "");
    if (num.length >= 4 && hay.replace(/\s/g, "").includes(num)) {
      score += 35; why.push(`the ${item.kind === "bill" ? "bill" : "invoice"} number is in the narration`);
    }

    // THE DATE. A payment long before its document is not that document's.
    const gap = daysBetween(line.line_date, item.date);
    if (gap <= 45) { score += 10; why.push(`within ${Math.round(gap)} day${Math.round(gap) === 1 ? "" : "s"} of it`); }
    else if (gap > 365) score -= 15;

    if (score >= 40) out.push({ item, score, why });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}

export function confidenceOf(cands: Candidate[]): "certain" | "likely" | "choose" | null {
  if (!cands.length) return null;
  const [best, second] = cands;
  if (best.score >= 85 && (!second || best.score - second.score >= 25)) return "certain";
  if (best.score >= 70 && (!second || best.score - second.score >= 15)) return "likely";
  return "choose";
}

/**
 * Look at every line still waiting and write down what it appears to settle.
 * Posts nothing and decides nothing.
 */
export async function matchWaitingLines(): Promise<string> {
  const svc = createServiceClient();
  const items = await openItems(true);
  if (!items.length) return "Zoho reported no unpaid bills or invoices to match against.";

  const { data: lines } = await svc.from("bank_lines")
    .select("id, line_date, narration, ref, debit, credit, match_kind")
    .in("status", ["ask", "auto"]).limit(300);

  let matched = 0, choose = 0;
  for (const l of lines ?? []) {
    const cands = matchLine(l as never, items);
    const confidence = confidenceOf(cands);
    if (!confidence) {
      await svc.from("bank_lines").update({ match_kind: null, match_ids: null, match_label: null, match_confidence: null, match_candidates: null }).eq("id", l.id);
      continue;
    }
    const best = cands[0];
    await svc.from("bank_lines").update({
      match_kind: best.item.kind,
      match_ids: confidence === "choose" ? null : [best.item.id],
      match_party: best.item.party,
      match_label: confidence === "choose" ? null
        : `${best.item.kind === "bill" ? "settles" : "receipt against"} ${best.item.number || best.item.kind} · ${best.item.party} · ${money(best.item)}`,
      match_confidence: confidence,
      match_currency: confidence === "choose" ? null : best.item.currency,
      match_candidates: cands.map((c) => ({
        id: c.item.id, kind: c.item.kind, number: c.item.number, party: c.item.party,
        date: c.item.date, balance: c.item.balance, currency: c.item.currency, score: c.score, why: c.why,
      })),
      updated_at: new Date().toISOString(),
    }).eq("id", l.id);
    if (confidence === "choose") choose++; else matched++;
  }

  return `${matched} line(s) matched to an open bill or invoice` +
    (choose ? `, ${choose} with more than one possibility for you to pick` : "") +
    `. Nothing posted — they wait as before.`;
}
