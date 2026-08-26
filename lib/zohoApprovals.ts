import { createServiceClient } from "@/lib/supabase/service";
import { withFounderApproval } from "@/lib/zohoGuard";

// THE GATE, AND WHAT STANDS BEHIND IT.
//
// The accounts desk prepares work and asks. The founder reads the request in
// the portal and releases it. Only a release opens the Zoho gate, and it opens
// for exactly one job.
//
// Adding a new kind of Zoho work means adding it to EXECUTORS below — until it
// is there, it cannot be released, and the guard blocks it from posting itself.

export type ApprovalKind =
  | "provider_bill"    // book a vendor bill
  | "bill_date_fix"    // move a booked bill to the date its invoice actually carries
  | "bill_open"        // take a bill out of draft in Zoho so it reaches the ledgers
  | "attach_paper"     // file the invoice PDF against a bill already in Zoho
  | "settlement"       // a Razorpay settlement
  | "bank_line"        // one line of a bank or card statement
  | "brokerage_line"   // one brokerage transaction
  | "sale"             // a portal sale → invoice + receipt
  | "petty_bill"       // a petty-cash bill
  | "petty_advance"    // a petty-cash advance
  | "outgoing"         // an invoice, credit note or journal WE raise
  | "website_sale"     // a subscription sold on the portal
  | "book_sale";       // a books order

/** What each kind actually does, once he has released it. */
const EXECUTORS: Record<ApprovalKind, (refId: string, details: Record<string, unknown>) => Promise<void>> = {
  provider_bill: async (id) => (await import("@/lib/providerBills")).postProviderBill(id),
  bill_date_fix: async (id, d) => (await import("@/lib/providerBills")).applyBillDateFix(id, String(d.date), Number(d.rate) || null),
  bill_open: async (id) => (await import("@/lib/providerBills")).openPostedBill(id),
  attach_paper: async (id) => (await import("@/lib/providerBills")).attachBillPaper(id),
  settlement: async (id) => (await import("@/lib/zohoSettlements")).postSettlement(id),
  bank_line: async (id, d) => (await import("@/lib/bankStatements")).postBankLine(id, String(d.accountChoice ?? ""), (d.subAccount as string | null) ?? null),
  brokerage_line: async (id, d) => { await (await import("@/lib/brokerage")).postBrokerageLine(id, d as never); },
  sale: async (id) => (await import("@/lib/zohoPosting")).postSale(id),
  petty_bill: async (id, d) => (await import("@/lib/pettyCash")).postBill(id, String(d.expenseAccount ?? "")),
  petty_advance: async (id) => (await import("@/lib/pettyCash")).postAdvance(id),
  outgoing: async (id) => (await import("@/lib/zohoOutgoing")).postOutgoing(id),
  website_sale: async (id) => (await import("@/lib/websiteSales")).postWebsiteSale("orders", id),
  book_sale: async (id) => (await import("@/lib/websiteSales")).postWebsiteSale("book_orders", id),
};

export type ApprovalRow = {
  id: string; kind: ApprovalKind; ref_table: string; ref_id: string;
  summary: string; details: Record<string, unknown> | null;
  status: string; requested_at: string; note: string | null;
  result?: { error?: string } | null; decided_at?: string | null;
};

/**
 * Ask him. Never posts anything itself.
 *
 * Asking twice for the same thing is not an error and does not queue it twice —
 * the desk pressing approve again should not put a second bill in the books.
 */
export async function requestApproval(req: {
  kind: ApprovalKind; refTable: string; refId: string;
  summary: string; details?: Record<string, unknown>; requestedBy?: string | null;
}): Promise<void> {
  const svc = createServiceClient();
  // Already on his desk? Then it stays there — asking twice must not queue the
  // same posting twice. (The unique index behind this is partial, on pending
  // rows only, which is deliberate: the same bill may be re-requested after a
  // rejection, but never while one is outstanding.)
  const { data: already } = await svc.from("zoho_approvals")
    .select("id").eq("kind", req.kind).eq("ref_id", req.refId).eq("status", "pending").maybeSingle();
  if (already) return;

  const { error } = await svc.from("zoho_approvals").insert({
    kind: req.kind, ref_table: req.refTable, ref_id: req.refId,
    summary: req.summary, details: req.details ?? null,
    requested_by: req.requestedBy ?? null, status: "pending",
  });
  // A request that cannot be recorded must be loud: silence here would look
  // exactly like "approved and posted" to whoever pressed the button.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(`could not put this to the founder: ${error.message}`);
}

/** How many things are waiting on him. */
export async function pendingCount(): Promise<number> {
  const svc = createServiceClient();
  const { count } = await svc.from("zoho_approvals")
    .select("id", { count: "exact", head: true }).eq("status", "pending");
  return count ?? 0;
}

/**
 * THINGS HE RELEASED THAT DID NOT POST.
 *
 * releaseApproval marks a failure as `failed`, and the gate only lists
 * `pending` — so the moment something failed it vanished from the one screen
 * he had been watching. He pressed approve on two Bunny bills, both were
 * refused by the TDS guard, and the gate went quiet as though the work were
 * done. The reason was on the row in the bills list further down, which is not
 * where anybody looks after pressing a button.
 *
 * They belong back in front of him, with the reason.
 */
export async function listFailed(limit = 20): Promise<ApprovalRow[]> {
  const svc = createServiceClient();
  const { data } = await svc.from("zoho_approvals")
    .select("id, kind, ref_table, ref_id, summary, details, status, requested_at, note, result, decided_at")
    .eq("status", "failed").order("decided_at", { ascending: false }).limit(limit);
  return (data ?? []) as unknown as ApprovalRow[];
}

/** Put a failed one back on his desk, so it can be released again once the
 *  reason is dealt with. */
export async function retryApproval(approvalId: string): Promise<void> {
  const svc = createServiceClient();
  await svc.from("zoho_approvals")
    .update({ status: "pending", result: null, decided_at: null, decided_by: null })
    .eq("id", approvalId).eq("status", "failed");
}

export async function listPending(limit = 100): Promise<ApprovalRow[]> {
  const svc = createServiceClient();
  const { data } = await svc.from("zoho_approvals")
    .select("id, kind, ref_table, ref_id, summary, details, status, requested_at, note")
    .eq("status", "pending").order("requested_at").limit(limit);
  return (data ?? []) as unknown as ApprovalRow[];
}

/**
 * He said yes. This is the ONLY path that opens the Zoho gate, and it opens it
 * for one job — the work runs inside withFounderApproval, and any other write
 * happening anywhere else at the same time is still blocked.
 */
export async function releaseApproval(approvalId: string, decidedBy: string | null): Promise<string> {
  const svc = createServiceClient();
  const { data: row } = await svc.from("zoho_approvals")
    .select("*").eq("id", approvalId).eq("status", "pending").maybeSingle();
  if (!row) return "That request is no longer waiting — it was already decided.";

  const run = EXECUTORS[row.kind as ApprovalKind];
  if (!run) return `Nothing here knows how to carry out "${row.kind}".`;

  try {
    await withFounderApproval(approvalId, () => run(String(row.ref_id), (row.details ?? {}) as Record<string, unknown>));
    await svc.from("zoho_approvals").update({
      status: "approved", decided_by: decidedBy, decided_at: new Date().toISOString(),
    }).eq("id", approvalId);
    return `Approved and posted: ${row.summary}`;
  } catch (e) {
    const why = e instanceof Error ? e.message : "unknown";
    await svc.from("zoho_approvals").update({
      status: "failed", decided_by: decidedBy, decided_at: new Date().toISOString(),
      result: { error: why },
    }).eq("id", approvalId);
    return `Approved, but it did not post: ${why}`;
  }
}

/** Is this failure Zoho refusing to talk to us for a minute, rather than
 *  refusing the document itself? */
export const isThrottle = (msg: string) =>
  /limit of 100 calls|throttling us|per-minute limit|exceeded the maximum number of requests|too many requests/i.test(msg);

/**
 * HE SAID YES BUT ZOHO HAD NO CAPACITY — hold it, do not ask him again.
 *
 * The row keeps who decided it and when, so the drain is finishing his
 * decision rather than making one.
 */
export async function queueApproval(approvalId: string, decidedBy: string | null): Promise<void> {
  const svc = createServiceClient();
  await svc.from("zoho_approvals").update({
    status: "queued", decided_by: decidedBy, decided_at: new Date().toISOString(),
    queued_at: new Date().toISOString(), result: null,
  }).eq("id", approvalId).in("status", ["pending", "failed"]);
}

/**
 * Post everything he already released, as far as the minute allows.
 *
 * Called by the drain cron every minute. Stops the moment Zoho throttles —
 * anything not reached stays `queued` and goes in the next run, so a backlog
 * of any size clears itself without him pressing anything again.
 */
export async function drainQueued(max = 40): Promise<{ posted: number; failed: number; left: number; stopped: boolean }> {
  const svc = createServiceClient();
  const { data } = await svc.from("zoho_approvals")
    .select("id, decided_by").eq("status", "queued").order("queued_at").limit(max);
  const rows = (data ?? []) as { id: string; decided_by: string | null }[];

  let posted = 0, failed = 0, stopped = false;
  for (const r of rows) {
    if (stopped) break;
    // Back to pending for the moment of release: releaseApproval only acts on a
    // pending row, and that single-row precondition is what stops two drains
    // posting the same thing twice.
    const { data: claimed } = await svc.from("zoho_approvals")
      .update({ status: "pending" }).eq("id", r.id).eq("status", "queued").select("id").maybeSingle();
    if (!claimed) continue;   // another run took it

    const note = await releaseApproval(r.id, r.decided_by);
    if (note.startsWith("Approved and posted")) posted++;
    else if (isThrottle(note)) {
      // Put it back and stop for this minute.
      await svc.from("zoho_approvals").update({
        status: "queued", queued_at: new Date().toISOString(), result: null, decided_at: null,
      }).eq("id", r.id);
      stopped = true;
    } else failed++;
  }

  const { count } = await svc.from("zoho_approvals")
    .select("id", { count: "exact", head: true }).eq("status", "queued");
  return { posted, failed, left: count ?? 0, stopped };
}

/** He said no. Nothing is sent, and the reason stays on the record. */
export async function rejectApproval(approvalId: string, decidedBy: string | null, note?: string): Promise<void> {
  const svc = createServiceClient();
  await svc.from("zoho_approvals").update({
    status: "rejected", decided_by: decidedBy, decided_at: new Date().toISOString(),
    note: note ?? null,
  }).eq("id", approvalId).eq("status", "pending");
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASKING, IN HIS WORDS
   He should not have to open another screen to know what he is approving, so
   each request describes itself from the row it came from.
   ═══════════════════════════════════════════════════════════════════════════ */
const money = (n: unknown) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

async function describe(kind: ApprovalKind, refId: string): Promise<{ summary: string; details: Record<string, unknown> }> {
  const svc = createServiceClient();
  const one = async (table: string, cols: string) =>
    (await svc.from(table).select(cols).eq("id", refId).maybeSingle()).data as Record<string, unknown> | null;

  if (kind === "provider_bill") {
    const b = await one("provider_bills", "institution, bill_no, bill_date, currency, amount, inr_amount, rate, proposal, determination, taxable_value, tds_amount");
    if (!b) return { summary: "A vendor bill", details: {} };
    const p = (b.proposal ?? {}) as Record<string, unknown>;
    const d = (b.determination ?? {}) as Record<string, unknown>;
    // The withholding in rupees, on the same base the posting uses — the
    // taxable value where the invoice's own tax has been keyed, never the
    // tax-inclusive total. A summary beside an approve button has to agree
    // with the entry underneath it.
    const withheld = Number(b.tds_amount) > 0 ? money(b.tds_amount) : null;
    return {
      summary: `Book ${b.institution} ${b.bill_no ?? ""} of ${b.bill_date} — ${b.currency} ${b.amount}` +
               (b.rate ? ` at ₹${b.rate}` : "") + ` = ${money(b.inr_amount)} → ${p.expense_account ?? "?"}` +
               ` · GST ${p.gst_treatment ?? "?"}` +
               (withheld ? ` · withhold ${withheld}${Number(b.taxable_value) > 0 ? ` of ${money(b.taxable_value)}` : ""}`
                 : d.tdsLabel ? ` · withhold ${d.tdsLabel}` : p.tds_section ? ` · TDS ${p.tds_section}` : " · no TDS"),
      details: { ...b },
    };
  }
  if (kind === "attach_paper") {
    const b = await one("provider_bills", "institution, bill_no, bill_date, inr_amount, zoho_echo");
    const z = (b?.zoho_echo ?? {}) as Record<string, unknown>;
    return {
      summary: b
        ? `Attach the invoice PDF to ${b.institution} ${b.bill_no ?? ""} of ${b.bill_date} (${money(b.inr_amount)})` +
          `${z.zoho_number ? ` — ${z.zoho_number} in Zoho` : ""}. No ledger changes.`
        : "Attach an invoice to a bill",
      details: { ...(b ?? {}) },
    };
  }
  if (kind === "settlement") {
    const r = await one("zoho_settlements", "settled_on, utr, gross_inr, net_inr, settlement_id");
    return { summary: r ? `Razorpay settlement of ${r.settled_on} — UTR ${r.utr ?? "—"}, gross ${money(r.gross_inr)}, net ${money(r.net_inr)}` : "A settlement", details: { ...(r ?? {}) } };
  }
  if (kind === "bank_line") {
    const r = await one("bank_lines", "line_date, account_name, narration, debit, credit, proposed_account");
    return { summary: r ? `${r.account_name} ${r.line_date} — ${String(r.narration).slice(0, 70)} · ${Number(r.debit) > 0 ? "out " + money(r.debit) : "in " + money(r.credit)} → ${r.proposed_account ?? "?"}` : "A statement line", details: { ...(r ?? {}) } };
  }
  if (kind === "brokerage_line") {
    const r = await one("brokerage_lines", "line_date, account_name, kind, symbol, usd_amount, inr_amount");
    return { summary: r ? `${r.account_name} ${r.line_date} — ${r.kind}${r.symbol ? " " + r.symbol : ""} $${r.usd_amount} = ${money(r.inr_amount)}` : "A brokerage line", details: { ...(r ?? {}) } };
  }
  if (kind === "sale") {
    const r = await one("zoho_postings", "order_no, payload");
    const pl = (r?.payload ?? {}) as Record<string, unknown>;
    return { summary: r ? `Sale #${r.order_no} — ${pl.customer ?? "?"} · ${pl.description ?? ""} · ${money(pl.amountInr)}` : "A sale", details: { ...(r ?? {}) } };
  }
  if (kind === "petty_bill") {
    const r = await one("petty_bills", "bill_date, amount, purpose");
    return { summary: r ? `Petty cash ${r.bill_date} — ${r.purpose} · ${money(r.amount)}` : "A petty-cash bill", details: { ...(r ?? {}) } };
  }
  if (kind === "website_sale" || kind === "book_sale") {
    const table = kind === "website_sale" ? "orders" : "book_orders";
    const r = await one(table, "amount_inr, invoice_no, created_at, kind");
    return {
      summary: r
        ? `Website ${kind === "book_sale" ? "books order" : "sale"} of ${String(r.created_at).slice(0, 10)} — ${money(r.amount_inr)}` +
          `${r.invoice_no ? ` · invoice ${r.invoice_no}` : ""}`
        : "A website sale",
      details: { ...(r ?? {}) },
    };
  }
  if (kind === "outgoing") {
    const r = await one("zoho_documents", "kind, party_name, doc_date, description, amount, currency, inr_amount, ledger, gst_treatment, gst_rate, tds_rate, journal_lines");
    if (!r) return { summary: "A document to raise", details: {} };
    const what = r.kind === "credit_note" ? "Credit note" : r.kind === "journal" ? "Journal entry" : "Invoice";
    const lines = (r.journal_lines ?? []) as { account: string; side: string; amount: number }[];
    return {
      summary: r.kind === "journal"
        ? `${what} of ${r.doc_date} — ${lines.map((l) => `${l.side === "debit" ? "Dr" : "Cr"} ${l.account} ${money(l.amount)}`).join(", ")}`
        : `${what} to ${r.party_name} of ${r.doc_date} — ${money(r.inr_amount ?? r.amount)} → ${r.ledger}` +
          `${r.gst_treatment === "charged" ? ` · GST ${r.gst_rate}%` : " · no GST"}` +
          `${Number(r.tds_rate) > 0 ? ` · they withhold ${r.tds_rate}% TDS` : ""}`,
      details: { ...r },
    };
  }
  if (kind === "petty_advance") {
    const r = await one("petty_advances", "advance_date, amount");
    return { summary: r ? `Petty-cash advance ${r?.advance_date} · ${money(r?.amount)}` : "A petty-cash advance", details: { ...(r ?? {}) } };
  }
  return { summary: kind, details: {} };
}

/**
 * The one line every desk calls instead of posting. Reads the row, writes the
 * request in plain words, and stops there.
 */
export async function requestApprovalFor(
  kind: ApprovalKind, refTable: string, refId: string,
  extra?: Record<string, unknown>, requestedBy?: string | null,
): Promise<void> {
  const { summary, details } = await describe(kind, refId);
  await requestApproval({ kind, refTable, refId, summary, details: { ...details, ...(extra ?? {}) }, requestedBy });
}
