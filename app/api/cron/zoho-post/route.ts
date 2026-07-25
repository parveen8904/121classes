import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getGstSettings, computeGst } from "@/lib/invoice";
import { zohoConfigured, postSaleToZoho } from "@/lib/zoho";

export const dynamic = "force-dynamic";

// Nightly: post team-APPROVED website sales into Zoho Books. Runs off-peak;
// does nothing until the founder's free Zoho Self Client keys are pasted in
// Admin → Integrations. Sales stay 'approved' (and retry next night) if a
// post fails — nothing is ever lost or double-posted.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const qp = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && qp !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  if (!(await zohoConfigured())) {
    return NextResponse.json({ ok: true, skipped: "Zoho keys not configured yet" });
  }

  const svc = createServiceClient();
  const s = await getGstSettings();
  let posted = 0, failed = 0;

  // Subscriptions / extensions.
  const { data: ordRows } = await svc
    .from("orders")
    .select("id, kind, amount_inr, created_at, invoice_no, profiles:student_id(full_name, email, state)")
    .eq("zoho_status", "approved").eq("status", "paid")
    .order("created_at").limit(25);
  for (const o of (ordRows ?? []) as unknown as { id: string; kind: string; amount_inr: number; created_at: string; invoice_no: string | null; profiles: { full_name: string | null; email: string | null; state: string | null } | null }[]) {
    try {
      const gst = computeGst(o.amount_inr ?? 0, o.profiles?.state ?? "", s);
      const zid = await postSaleToZoho({
        buyerName: o.profiles?.full_name ?? o.profiles?.email ?? "Website customer",
        buyerEmail: o.profiles?.email ?? null,
        description: o.kind === "extension" ? "Online classes — subscription extension" : "Online classes subscription",
        taxableInr: gst.taxable,
        interState: gst.igst > 0,
        invoiceNo: o.invoice_no,
        dateISO: o.created_at,
      });
      await svc.from("orders").update({ zoho_status: "posted", zoho_invoice_id: zid }).eq("id", o.id);
      posted++;
    } catch (e) {
      console.error("zoho-post order", o.id, e);
      failed++;
    }
  }

  // Book orders.
  type Ship = { name?: string; state?: string };
  type Contact = { name?: string; email?: string };
  const { data: bookRows } = await svc
    .from("book_orders")
    .select("id, amount_inr, created_at, invoice_no, guest_contact, ship_to")
    .eq("zoho_status", "approved").neq("status", "cancelled")
    .order("created_at").limit(25);
  for (const b of (bookRows ?? []) as unknown as { id: string; amount_inr: number; created_at: string; invoice_no: string | null; guest_contact: Contact | null; ship_to: Ship | null }[]) {
    try {
      const gst = computeGst(b.amount_inr ?? 0, b.ship_to?.state ?? "", s);
      const zid = await postSaleToZoho({
        buyerName: b.guest_contact?.name ?? b.ship_to?.name ?? "Book buyer",
        buyerEmail: b.guest_contact?.email ?? null,
        description: "Books order",
        taxableInr: gst.taxable,
        interState: gst.igst > 0,
        invoiceNo: b.invoice_no,
        dateISO: b.created_at,
      });
      await svc.from("book_orders").update({ zoho_status: "posted", zoho_invoice_id: zid }).eq("id", b.id);
      posted++;
    } catch (e) {
      console.error("zoho-post book", b.id, e);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, posted, failed });
}
