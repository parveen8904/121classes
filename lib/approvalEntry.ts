import { createServiceClient } from "@/lib/supabase/service";
import { tdsWorking } from "@/lib/postingShape";
import { purchaseEntry, saleEntry, bankEntry, settlementEntry, type Entry } from "@/lib/entryPreview";

// THE ENTRY BEHIND ONE THING WAITING AT THE GATE.
//
// The approval gate listed a sentence and two buttons, which is exactly the
// position he objected to: he was being asked to release something into the
// books without being shown what it does to them. This reads the row the
// approval points at and works out the entry from the same fields the posting
// will use.
//
// It returns null rather than a guess. A kind whose entry cannot be derived
// honestly — one Zoho composes itself, or a row that has since been deleted —
// shows no table, and the gate says so. An invented preview beside an approve
// button would be worse than none at all.

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? "").trim();

export async function entryForApproval(a: {
  kind: string;
  ref_table: string;
  ref_id: string;
  details?: Record<string, unknown> | null;
}): Promise<Entry | null> {
  const svc = createServiceClient();

  try {
    /* Something we are raising — an invoice, a credit note or a journal. */
    if (a.kind === "outgoing" || a.ref_table === "zoho_documents") {
      const { data: d } = await svc.from("zoho_documents").select("*").eq("id", a.ref_id).maybeSingle();
      if (!d) return null;

      if (d.kind === "journal") {
        const lines = (d.journal_lines ?? []) as { account: string; side: "debit" | "credit"; amount: number; note?: string }[];
        if (lines.length < 2) return null;
        const dr = lines.filter((l) => l.side === "debit").reduce((t, l) => t + n(l.amount), 0);
        const cr = lines.filter((l) => l.side === "credit").reduce((t, l) => t + n(l.amount), 0);
        return {
          lines: lines.map((l) => ({ account: l.account, side: l.side, amount: n(l.amount), note: l.note })),
          dr: Number(dr.toFixed(2)), cr: Number(cr.toFixed(2)),
          balanced: Math.abs(dr - cr) < 0.02, caveats: [],
        };
      }

      return saleEntry({
        who: s(d.party_name),
        account: s(d.ledger),
        subAccount: s(d.sub_account) || null,
        gstTreatment: s(d.gst_treatment),
        gstRate: n(d.gst_rate) || 18,
        intraState: s(d.party_state) === "DL" || !s(d.party_state),
        amount: n(d.inr_amount) || n(d.amount),
        tdsRate: n(d.tds_rate),
        isCreditNote: d.kind === "credit_note",
      });
    }

    /* A supplier's bill the desk has worked out. */
    if (a.ref_table === "provider_bills") {
      const { data: b } = await svc.from("provider_bills").select("*").eq("id", a.ref_id).maybeSingle();
      if (!b) return null;
      const p = (b.proposal ?? {}) as Record<string, unknown>;
      const inr = n(b.inr_amount) || (n(b.rate) ? n(b.amount) * n(b.rate) : n(b.amount));
      const mode = s(b.tds_mode) || s(p.tds_mode) || (s(p.tds_section) ? "deduct" : "none");
      return purchaseEntry({
        who: s(p.vendor_name) || s(b.institution),
        account: s(p.expense_account),
        subAccount: s(b.sub_account) || null,
        nature: (s(p.nature) || "expense") as never,
        gstTreatment: s(p.gst_treatment) || "rcm",
        gstRate: n(p.gst_rate) || 18,
        tds: tdsWorking(inr, mode as never, n(p.tds_rate), s(p.vendor_name) || s(b.institution)),
        tdsSection: s(p.tds_section) || null,
      });
    }

    /* A line off a bank statement — either settling a document or its own entry. */
    if (a.ref_table === "bank_lines") {
      const { data: l } = await svc.from("bank_lines").select("*").eq("id", a.ref_id).maybeSingle();
      if (!l) return null;
      const ids = Array.isArray(l.match_ids) ? (l.match_ids as string[]) : [];
      if (l.match_kind && ids.length) {
        return settlementEntry({
          bank: s(l.account_name),
          party: s(l.matched_party) || s(a.details?.party) || "the other party",
          amount: n(l.debit) > 0 ? n(l.debit) : n(l.credit),
          kind: String(l.match_kind) === "bill" ? "bill" : "invoice",
        });
      }
      const account = s(l.account_choice) || s(l.proposal && (l.proposal as Record<string, unknown>).account) || "";
      if (!account) return null;
      return bankEntry({ bank: s(l.account_name), account, debit: n(l.debit), credit: n(l.credit) });
    }

    /* A sale from the portal — the invoice Zoho will carry. */
    if (a.ref_table === "orders" || a.ref_table === "gift_orders" || a.ref_table === "book_orders") {
      const { data: o } = await svc.from(a.ref_table).select("*").eq("id", a.ref_id).maybeSingle();
      if (!o) return null;
      const gross = n(o.amount_inr);
      // The portal's prices are GST-inclusive, so the income is the value inside
      // them — showing the whole receipt as income would overstate the sale and
      // understate the tax collected.
      const rate = 18;
      const base = Number((gross / (1 + rate / 100)).toFixed(2));
      const state = s(o.billing_state) || s(o.state) || "DL";
      return saleEntry({
        who: s(o.billing_name) || s(o.recipient_name) || "the student",
        account: a.ref_table === "book_orders" ? "Sales-Books" : "Sales-Classes",
        gstTreatment: "charged",
        gstRate: rate,
        intraState: state === "DL",
        amount: base,
      });
    }
  } catch {
    // A preview must never be the reason an approval cannot be looked at.
    return null;
  }
  return null;
}
