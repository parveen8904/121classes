import { zohoFetch } from "@/lib/zohoApi";
import { createServiceClient } from "@/lib/supabase/service";

// WHAT HAS CHANGED IN THE BOOKS, AND WHO CHANGED IT.
//
// The desk can only tell him what IT did. That is the smaller half: his team
// works in Zoho directly, and an entry altered there is invisible from here.
// So this asks Zoho itself — every module that carries money, newest change
// first — and marks which of them came from this desk with his approval and
// which came from somebody working in Zoho.
//
// Read-only by construction: every call here is a GET, so the founder's gate
// (lib/zohoGuard.ts) lets it through without an approval and it can never
// alter anything itself.

export type Activity = {
  when: string;            // ISO, when it was last touched
  kind: string;            // Invoice, Bill, Payment received…
  label: string;           // the document, in his words
  amount: number | null;
  currency: string;
  status: string | null;
  by: string | null;       // who raised it, as Zoho records it
  created: boolean;        // raised now, or an existing entry altered
  ours: boolean;           // this desk posted it, on his approval
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * One module, newest change first.
 *
 * Not every module accepts the same sort: /expenses refuses last_modified_time
 * outright. The first version of this swallowed that and returned nothing, so
 * expenses simply vanished from the report — a silence that reads exactly like
 * "nothing has changed". So each module is tried on the sorts it might accept,
 * and a module that still cannot be read is REPORTED, not hidden.
 */
async function pull(
  path: string, key: string, kind: string, sort: string,
  map: (r: Row) => { id: string; label: string; amount: number | null; currency: string; status: string | null },
  perPage = 25,
): Promise<{ rows: Activity[]; failed: string | null }> {
  // EACH MODULE IS ASKED ONCE, ON THE SORT IT ACCEPTS.
  //
  // Trying three sorts on seven modules meant up to twenty-one requests in a
  // burst, and Zoho started refusing them — the report then reported its own
  // throttling as a module it could not read. One call each, one retry without
  // the sort, and no more.
  try {
    const r = await zohoFetch<Record<string, Row[]>>(path, {
      query: { sort_column: sort, sort_order: "D", per_page: String(perPage) },
    });
    return { rows: mapRows(r[key] ?? [], kind, map), failed: null };
  } catch {
    try {
      const r = await zohoFetch<Record<string, Row[]>>(path, { query: { per_page: String(perPage) } });
      return { rows: mapRows(r[key] ?? [], kind, map), failed: null };
    } catch (e) {
      return { rows: [], failed: `${kind}: ${e instanceof Error ? e.message : "could not be read"}` };
    }
  }
}

function mapRows(
  rows: Row[], kind: string,
  map: (r: Row) => { id: string; label: string; amount: number | null; currency: string; status: string | null },
): Activity[] {
  {
    return rows.map((row) => {
      const m = map(row);
      const modified = str(row.last_modified_time) ?? str(row.created_time) ?? "";
      const createdAt = str(row.created_time) ?? "";
      return {
        when: modified,
        kind,
        label: m.label,
        amount: m.amount,
        currency: m.currency || "INR",
        status: m.status,
        by: str(row.created_by),
        // Zoho stamps both times on creation, a second or two apart.
        created: !createdAt || Math.abs(new Date(modified).getTime() - new Date(createdAt).getTime()) < 120_000,
        ours: false,
        _id: m.id,
      } as Activity & { _id: string };
    });
  }
}

/**
 * The last N changes across the books, newest first.
 *
 * `limit` is what he sees; each module is asked for a slice and the merged list
 * is cut to size, so a busy day of invoices cannot hide a single altered bill.
 */
export async function recentZohoActivity(limit = 50): Promise<{ rows: Activity[]; unread: string[] }> {
  const pulled = await Promise.all([
    pull("/invoices", "invoices", "Invoice", "last_modified_time", (r) => ({
      id: String(r.invoice_id), label: `${str(r.invoice_number) ?? "—"} · ${str(r.customer_name) ?? ""}`,
      amount: num(r.total), currency: String(r.currency_code ?? "INR"), status: str(r.status),
    })),
    pull("/bills", "bills", "Bill", "last_modified_time", (r) => ({
      id: String(r.bill_id), label: `${str(r.bill_number) ?? "—"} · ${str(r.vendor_name) ?? ""}`,
      amount: num(r.total), currency: String(r.currency_code ?? "INR"), status: str(r.status),
    })),
    pull("/customerpayments", "customerpayments", "Payment received", "last_modified_time", (r) => ({
      id: String(r.payment_id), label: `${str(r.payment_number) ?? str(r.reference_number) ?? "—"} · ${str(r.customer_name) ?? ""}`,
      amount: num(r.amount), currency: String(r.currency_code ?? "INR"), status: str(r.status),
    })),
    pull("/vendorpayments", "vendorpayments", "Payment made", "last_modified_time", (r) => ({
      id: String(r.payment_id), label: `${str(r.payment_number) ?? "—"} · ${str(r.vendor_name) ?? ""}`,
      amount: num(r.amount), currency: String(r.currency_code ?? "INR"), status: null,
    })),
    pull("/expenses", "expenses", "Expense", "date", (r) => ({
      id: String(r.expense_id), label: `${str(r.account_name) ?? "—"}${r.description ? ` · ${String(r.description).slice(0, 60)}` : ""}`,
      amount: num(r.total), currency: String(r.currency_code ?? "INR"), status: str(r.status),
    })),
    pull("/journals", "journals", "Journal entry", "date", (r) => ({
      id: String(r.journal_id), label: `${str(r.entry_number) ?? str(r.journal_id)} · ${str(r.reference_number) ?? str(r.notes) ?? ""}`.slice(0, 90),
      amount: num(r.total), currency: String(r.currency_code ?? "INR"), status: str(r.status),
    })),
    pull("/contacts", "contacts", "Customer / vendor", "last_modified_time", (r) => ({
      id: String(r.contact_id), label: `${str(r.contact_name) ?? "—"}${r.contact_type ? ` (${String(r.contact_type)})` : ""}`,
      amount: null, currency: "INR", status: str(r.status),
    }), 15),
  ]);

  const all = pulled.flatMap((p) => p.rows) as (Activity & { _id: string })[];
  const unread = pulled.map((p) => p.failed).filter(Boolean) as string[];

  // WHICH OF THESE WERE OURS. Anything this desk posted carries its Zoho id in
  // our own tables, so a row can say plainly whether it came through the gate
  // he approves or from somebody working in Zoho directly.
  const svc = createServiceClient();
  const [pb, zp] = await Promise.all([
    svc.from("provider_bills").select("zoho_bill_id").not("zoho_bill_id", "is", null),
    svc.from("zoho_postings").select("zoho_invoice_id").not("zoho_invoice_id", "is", null),
  ]);
  const mine = new Set<string>([
    ...((pb.data ?? []).map((r) => String(r.zoho_bill_id))),
    ...((zp.data ?? []).map((r) => String(r.zoho_invoice_id))),
  ]);

  const rows = all
    .filter((a) => a.when)
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, limit)
    .map(({ _id, ...a }) => ({ ...a, ours: mine.has(_id) }));
  return { rows, unread };
}
