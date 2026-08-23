import { createServiceClient } from "@/lib/supabase/service";
import { getGstSettings, computeGst } from "@/lib/invoice";
import { postSaleToZoho } from "@/lib/zoho";

// A SALE MADE ON THE WEBSITE, PUT INTO THE BOOKS.
//
// This used to happen unattended in the night: a cron read every approved sale
// and wrote it straight into Zoho. Two things were wrong with that.
//
// First, it wrote to his books with nobody's approval, which is the one thing
// he has said must never happen. It now prepares each sale and asks; releasing
// it runs exactly the same posting, through the gate.
//
// Second, when a posting failed the reason went to the server log and nowhere
// else. Twenty-one approved sales sat unposted for weeks with nothing on the
// row to say why, while the customer for each was created in Zoho on every
// nightly retry — which is what he noticed at half past three in the morning.

export type SaleTable = "orders" | "book_orders";

type Contact = { name?: string; email?: string };
type Ship = { name?: string; state?: string };

/** Post one approved website sale. Runs only from a released approval. */
export async function postWebsiteSale(table: SaleTable, id: string): Promise<void> {
  const svc = createServiceClient();
  const settings = await getGstSettings();

  const cols = table === "orders"
    ? "id, kind, amount_inr, created_at, invoice_no, zoho_status, profiles:student_id(full_name, email, state)"
    : "id, amount_inr, created_at, invoice_no, zoho_status, guest_contact, ship_to";
  const { data: row } = await svc.from(table).select(cols).eq("id", id).maybeSingle();
  if (!row) throw new Error("that sale is no longer here");
  const r = row as unknown as {
    kind?: string; amount_inr: number; created_at: string; invoice_no: string | null; zoho_status: string;
    profiles?: { full_name: string | null; email: string | null; state: string | null } | null;
    guest_contact?: Contact | null; ship_to?: Ship | null;
  };
  if (r.zoho_status === "posted") return;

  const state = table === "orders" ? (r.profiles?.state ?? "") : (r.ship_to?.state ?? "");
  const gst = computeGst(r.amount_inr ?? 0, state, settings);

  try {
    const zid = await postSaleToZoho({
      buyerName: table === "orders"
        ? (r.profiles?.full_name ?? r.profiles?.email ?? "Website customer")
        : (r.guest_contact?.name ?? r.ship_to?.name ?? "Book buyer"),
      buyerEmail: table === "orders" ? (r.profiles?.email ?? null) : (r.guest_contact?.email ?? null),
      description: table === "book_orders" ? "Books order"
        : r.kind === "extension" ? "Online classes — subscription extension"
        : "Online classes subscription",
      taxableInr: gst.taxable,
      interState: gst.igst > 0,
      invoiceNo: r.invoice_no,
      dateISO: r.created_at,
    });
    await svc.from(table).update({ zoho_status: "posted", zoho_invoice_id: zid, zoho_error: null }).eq("id", id);
  } catch (e) {
    // ON THE ROW, not only in a log nobody reads.
    const why = e instanceof Error ? e.message : "posting failed";
    await svc.from(table).update({ zoho_error: why }).eq("id", id);
    throw new Error(why);
  }
}

/**
 * Put every approved sale in front of him. Posts nothing.
 *
 * Asking twice is harmless — a sale already waiting is not queued again.
 */
export async function queueApprovedSales(): Promise<{ queued: number; already: number }> {
  const svc = createServiceClient();
  const { requestApprovalFor } = await import("@/lib/zohoApprovals");
  let queued = 0, already = 0;

  for (const [table, kind] of [["orders", "website_sale"], ["book_orders", "book_sale"]] as const) {
    let q = svc.from(table).select("id").eq("zoho_status", "approved").order("created_at").limit(50);
    if (table === "book_orders") q = q.neq("status", "cancelled");
    const { data } = await q;
    for (const row of data ?? []) {
      const { data: pending } = await svc.from("zoho_approvals")
        .select("id").eq("kind", kind).eq("ref_id", String(row.id)).eq("status", "pending").maybeSingle();
      if (pending) { already++; continue; }
      await requestApprovalFor(kind, table, String(row.id));
      queued++;
    }
  }
  return { queued, already };
}
