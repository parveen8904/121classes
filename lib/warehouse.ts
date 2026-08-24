import { createServiceClient } from "@/lib/supabase/service";
import { parsePostalParts } from "@/lib/indiaStates";
import { sendEmail, emailConfigured, emailShell } from "@/lib/notify";
import { getSecret } from "@/lib/secrets";

type Ship = { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; phone?: string; email?: string };
type Item = { book_id?: string; qty?: number };
type OrderRow = {
  id: string;
  guest_contact: { name?: string; phone?: string; email?: string } | null;
  ship_to: Ship | null;
  items: Item[] | null;
};

// One parcel the warehouse must courier — a book order OR the free books set
// of a 9+ month Gold subscription.
export type DispatchItem = {
  table: "orders" | "book_orders" | "gift_orders";
  id: string;
  orderNo: string;
  name: string;
  address: string;
  phone: string;
  // The address a parcel query is answered to. A packer chasing a bad PIN, or
  // the office telling somebody their books have gone, writes to this.
  email: string;
  contents: string;
  createdAt: string;
  tracking: string | null;
  courier: string | null;
  // The tax invoice for this sale. A packer needs it to put a copy in the box,
  // and needed an admin to fetch it until now.
  invoiceNo: string | null;
  invoiceUrl: string | null;
  // Split out for the courier sheet: a spreadsheet is sorted on a PIN code,
  // not on a paragraph. Blank where we genuinely do not know.
  city: string;
  state: string;
  pincode: string;
};

// Everything awaiting courier: paid book orders + paid books-due Gold sales,
// newest first. `pendingOnly` drops parcels that already have a tracking ID.
export async function listDispatchQueue(pendingOnly = true): Promise<DispatchItem[]> {
  const svc = createServiceClient();
  const [{ data: bookRows }, { data: goldRows }, { data: giftRows }] = await Promise.all([
    svc.from("book_orders")
      .select("id, order_no, guest_contact, ship_to, items, created_at, tracking_code, courier_name, invoice_no, invoice_url, status")
      .in("status", ["paid", "dispatched"])
      .order("created_at", { ascending: false }).limit(200),
    svc.from("orders")
      .select("id, order_no, created_at, tracking_code, courier_name, invoice_no, invoice_url, subjects:subject_id(title), profiles:student_id(full_name, email, phone, address_line1, address_line2, city, state, pincode)")
      .eq("books_due", true).eq("status", "paid")
      .order("created_at", { ascending: false }).limit(200),
    // Gifted 9+ month Gold also ships books — to the RECIPIENT's address.
    // A vendor/gift order's lifecycle is created → PROVISIONED (never "paid"):
    // filtering on "paid" here meant no vendor sale ever reached the warehouse,
    // even with books_due set and the address on file — the office complaint of
    // 20 August. Same trap the orders page hit; see lib/orderStatus.ts.
    svc.from("gift_orders")
      .select("id, order_no, created_at, tracking_code, recipient_name, recipient_email, recipient_phone, recipient_address, courier_name, invoice_no, invoice_url, subjects:subject_id(title)")
      .eq("books_due", true).in("status", ["paid", "provisioned", "dispatched"])
      .order("created_at", { ascending: false }).limit(200),
  ]);

  const ids = [...new Set(((bookRows ?? []) as unknown as OrderRow[]).flatMap((o) => (o.items ?? []).map((i) => i.book_id).filter(Boolean)))] as string[];
  const { data: books } = ids.length
    ? await createServiceClient().from("books").select("id, title").in("id", ids)
    : { data: [] as { id: string; title: string }[] };
  const titleById = new Map((books ?? []).map((b) => [b.id, b.title]));

  const out: DispatchItem[] = [];
  for (const o of (bookRows ?? []) as unknown as (OrderRow & { order_no: number | null; created_at: string; tracking_code: string | null; courier_name: string | null; invoice_no: string | null; invoice_url: string | null })[]) {
    const s = o.ship_to ?? {};
    out.push({
      table: "book_orders", id: o.id, orderNo: o.order_no ? `#${o.order_no}` : "—",
      name: s.name ?? o.guest_contact?.name ?? "Customer",
      address: [s.line1, s.line2, [s.city, s.state, s.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      phone: s.phone ?? o.guest_contact?.phone ?? "",
      email: s.email ?? o.guest_contact?.email ?? "",
      contents: (o.items ?? []).map((i) => `${titleById.get(i.book_id ?? "") ?? "Book"} × ${i.qty ?? 1}`).join(", ") || "Books",
      createdAt: o.created_at, tracking: o.tracking_code, courier: o.courier_name ?? null,
      invoiceNo: o.invoice_no ?? null, invoiceUrl: o.invoice_url ?? null,
      city: s.city ?? "", state: s.state ?? "", pincode: s.pincode ?? "",
    });
  }
  type GoldRow = { id: string; order_no: number | null; created_at: string; tracking_code: string | null; courier_name?: string | null; invoice_no?: string | null; invoice_url?: string | null; subjects: { title: string } | null; profiles: { full_name: string | null; email: string | null; phone: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; pincode: string | null } | null };
  for (const g of (goldRows ?? []) as unknown as GoldRow[]) {
    const p = g.profiles;
    out.push({
      table: "orders", id: g.id, orderNo: g.order_no ? `#${g.order_no}` : "—",
      name: p?.full_name ?? "Student",
      address: p ? [p.address_line1, p.address_line2, [p.city, p.state, p.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "",
      phone: p?.phone ?? "",
      email: p?.email ?? "",
      contents: `${g.subjects?.title ?? "Gold"} — FREE printed books set (9+ month Gold)`,
      createdAt: g.created_at, tracking: g.tracking_code, courier: g.courier_name ?? null,
      invoiceNo: g.invoice_no ?? null, invoiceUrl: g.invoice_url ?? null,
      city: p?.city ?? "", state: p?.state ?? "", pincode: p?.pincode ?? "",
    });
  }
  type GiftRow = { id: string; order_no: number | null; created_at: string; tracking_code: string | null; courier_name?: string | null; invoice_no?: string | null; invoice_url?: string | null; recipient_name: string | null; recipient_email: string | null; recipient_phone: string | null; recipient_address: string | null; subjects: { title: string } | null };
  for (const g of (giftRows ?? []) as unknown as GiftRow[]) {
    out.push({
      table: "gift_orders", id: g.id, orderNo: g.order_no ? `#${g.order_no}` : "—",
      name: g.recipient_name ?? "Gift recipient",
      address: g.recipient_address ?? "",
      phone: g.recipient_phone ?? "",
      email: g.recipient_email ?? "",
      contents: `🎁 GIFT — ${g.subjects?.title ?? "Gold"} FREE printed books set (9+ month Gold)`,
      createdAt: g.created_at, tracking: g.tracking_code, courier: g.courier_name ?? null,
      invoiceNo: g.invoice_no ?? null, invoiceUrl: g.invoice_url ?? null,
      // A supporter sale stores the address as one written block, so it is read
      // back rather than joined up.
      ...parsePostalParts(g.recipient_address),
    });
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return pendingOnly ? out.filter((i) => !i.tracking) : out;
}

/**
 * ONE NIGHTLY EMAIL, NOT TWO — AND THIS IS THE BUTTON THAT SENDS IT NOW.
 *
 * There used to be two warehouse mails on two schedules: a midnight-IST
 * spreadsheet, and this one at 18:00 IST carrying an HTML table and NO
 * attachment, built from its own slightly different idea of what was owed. Two
 * lists at two moments meant the packer had to reconcile them, and a parcel
 * could sit in one and not the other. It is also why an email arrived with
 * nothing attached: this was the one that sent it.
 *
 * They are folded together. The nightly job is /api/cron/day-orders, and this
 * function — the "send the dispatch list now" button on the orders page — runs
 * the same code over the same list, so the button and the cron cannot drift
 * apart again.
 */
export async function runWarehouseDispatch(): Promise<{ ok: boolean; count: number; skipped?: string }> {
  const { parcelsOwed, markReported, dispatchWorkbook, dayReportHtml, dayReportRecipients, istDayJustEnded } =
    await import("@/lib/dayOrderReport");

  if (!(await emailConfigured())) {
    return { ok: false, count: 0, skipped: "email is not configured — nothing was sent" };
  }
  const to = await dayReportRecipients();
  if (!to.length) {
    return { ok: false, count: 0, skipped: "nobody to send to — set WAREHOUSE_EMAIL on Admin → Integrations" };
  }

  const rows = await parcelsOwed();
  const label = istDayJustEnded();
  const subject = `\u{1F4E6} ${rows.length} parcel(s) to pack`;
  const html = emailShell(subject, dayReportHtml(label, rows));

  const attachment = await dispatchWorkbook(rows, label);
  const { sendEmailWithAttachment } = await import("@/lib/notify");
  let sent = 0;
  for (const address of to) {
    const ok = await sendEmailWithAttachment(address, subject, html, attachment).catch(() => false);
    if (ok) sent++;
  }
  if (!sent) return { ok: false, count: rows.length, skipped: "the email reached nobody — nothing was marked as reported" };

  // Send first, stamp second. A parcel stamped and never sent is one nobody
  // ever packs; a parcel reported twice is merely a nuisance.
  await markReported(rows);
  return { ok: true, count: rows.length };
}
