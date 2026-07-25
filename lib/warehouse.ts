import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailConfigured, emailShell } from "@/lib/notify";

type Ship = { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; phone?: string };
type Item = { book_id?: string; qty?: number };
type OrderRow = {
  id: string;
  guest_contact: { name?: string; phone?: string } | null;
  ship_to: Ship | null;
  items: Item[] | null;
};

// One parcel the warehouse must courier — a book order OR the free books set
// of a 9+ month Gold subscription.
export type DispatchItem = {
  table: "orders" | "book_orders";
  id: string;
  orderNo: string;
  name: string;
  address: string;
  phone: string;
  contents: string;
  createdAt: string;
  tracking: string | null;
};

// Everything awaiting courier: paid book orders + paid books-due Gold sales,
// newest first. `pendingOnly` drops parcels that already have a tracking ID.
export async function listDispatchQueue(pendingOnly = true): Promise<DispatchItem[]> {
  const svc = createServiceClient();
  const [{ data: bookRows }, { data: goldRows }] = await Promise.all([
    svc.from("book_orders")
      .select("id, order_no, guest_contact, ship_to, items, created_at, tracking_code, status")
      .in("status", ["paid", "dispatched"])
      .order("created_at", { ascending: false }).limit(200),
    svc.from("orders")
      .select("id, order_no, created_at, tracking_code, subjects:subject_id(title), profiles:student_id(full_name, phone, address_line1, address_line2, city, state, pincode)")
      .eq("books_due", true).eq("status", "paid")
      .order("created_at", { ascending: false }).limit(200),
  ]);

  const ids = [...new Set(((bookRows ?? []) as unknown as OrderRow[]).flatMap((o) => (o.items ?? []).map((i) => i.book_id).filter(Boolean)))] as string[];
  const { data: books } = ids.length
    ? await createServiceClient().from("books").select("id, title").in("id", ids)
    : { data: [] as { id: string; title: string }[] };
  const titleById = new Map((books ?? []).map((b) => [b.id, b.title]));

  const out: DispatchItem[] = [];
  for (const o of (bookRows ?? []) as unknown as (OrderRow & { order_no: number | null; created_at: string; tracking_code: string | null })[]) {
    const s = o.ship_to ?? {};
    out.push({
      table: "book_orders", id: o.id, orderNo: o.order_no ? `#${o.order_no}` : "—",
      name: s.name ?? o.guest_contact?.name ?? "Customer",
      address: [s.line1, s.line2, [s.city, s.state, s.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      phone: s.phone ?? o.guest_contact?.phone ?? "",
      contents: (o.items ?? []).map((i) => `${titleById.get(i.book_id ?? "") ?? "Book"} × ${i.qty ?? 1}`).join(", ") || "Books",
      createdAt: o.created_at, tracking: o.tracking_code,
    });
  }
  type GoldRow = { id: string; order_no: number | null; created_at: string; tracking_code: string | null; subjects: { title: string } | null; profiles: { full_name: string | null; phone: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; pincode: string | null } | null };
  for (const g of (goldRows ?? []) as unknown as GoldRow[]) {
    const p = g.profiles;
    out.push({
      table: "orders", id: g.id, orderNo: g.order_no ? `#${g.order_no}` : "—",
      name: p?.full_name ?? "Student",
      address: p ? [p.address_line1, p.address_line2, [p.city, p.state, p.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "",
      phone: p?.phone ?? "",
      contents: `${g.subjects?.title ?? "Gold"} — FREE printed books set (9+ month Gold)`,
      createdAt: g.created_at, tracking: g.tracking_code,
    });
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return pendingOnly ? out.filter((i) => !i.tracking) : out;
}

// Email the warehouse the list of paid, not-yet-notified book orders, then
// stamp them. Returns a summary. Safe to call repeatedly (idempotent on the flag).
export async function runWarehouseDispatch(): Promise<{ ok: boolean; count: number; skipped?: string }> {
  const warehouse = process.env.WAREHOUSE_EMAIL;
  if (!warehouse || !(await emailConfigured())) {
    return { ok: true, count: 0, skipped: "email or WAREHOUSE_EMAIL not configured" };
  }

  const svc = createServiceClient();
  const [{ data: orders }, { data: goldOrders }] = await Promise.all([
    svc.from("book_orders")
      .select("id, order_no, guest_contact, ship_to, items")
      .eq("status", "paid")
      .is("warehouse_notified_at", null)
      .order("created_at", { ascending: true }),
    // 9+ month Gold sales owe a FREE books parcel too.
    svc.from("orders")
      .select("id, order_no, subjects:subject_id(title), profiles:student_id(full_name, phone, address_line1, address_line2, city, state, pincode)")
      .eq("books_due", true).eq("status", "paid")
      .is("warehouse_notified_at", null)
      .order("created_at", { ascending: true }),
  ]);

  const list = (orders ?? []) as unknown as (OrderRow & { order_no?: number | null })[];
  type GoldRow = { id: string; order_no: number | null; subjects: { title: string } | null; profiles: { full_name: string | null; phone: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; pincode: string | null } | null };
  const goldList = (goldOrders ?? []) as unknown as GoldRow[];
  if (!list.length && !goldList.length) return { ok: true, count: 0 };

  const ids = [...new Set(list.flatMap((o) => (o.items ?? []).map((i) => i.book_id).filter(Boolean)))] as string[];
  const { data: books } = ids.length
    ? await svc.from("books").select("id, title").in("id", ids)
    : { data: [] as { id: string; title: string }[] };
  const titleById = new Map((books ?? []).map((b) => [b.id, b.title]));

  const bookRows = list
    .map((o) => {
      const s = o.ship_to ?? {};
      const items = (o.items ?? [])
        .map((i) => `${titleById.get(i.book_id ?? "") ?? "Book"} × ${i.qty ?? 1}`)
        .join(", ");
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${o.order_no ? `#${o.order_no}` : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${items}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${s.name ?? o.guest_contact?.name ?? ""}<br>${s.line1 ?? ""}${s.line2 ? ", " + s.line2 : ""}, ${s.city ?? ""}, ${s.state ?? ""} ${s.pincode ?? ""}<br>📞 ${s.phone ?? o.guest_contact?.phone ?? ""}</td>
      </tr>`;
    })
    .join("");
  const goldRows = goldList
    .map((g) => {
      const p = g.profiles;
      const addr = p ? [p.address_line1, p.address_line2, [p.city, p.state, p.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${g.order_no ? `#${g.order_no}` : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">📦 ${g.subjects?.title ?? "Gold"} — FREE printed books set (9+ month Gold)</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${p?.full_name ?? ""}<br>${addr}<br>📞 ${p?.phone ?? ""}</td>
      </tr>`;
    })
    .join("");

  const total = list.length + goldList.length;
  const html = emailShell(
    `📦 Dispatch list — ${total} parcel${total === 1 ? "" : "s"}`,
    `<p>Please pack and ship the following (free shipping). Print the shipping labels and enter each courier
     tracking ID on the Warehouse page: <a href="https://caparveensharma.com/admin/warehouse">caparveensharma.com/admin/warehouse</a></p>
     <table style="width:100%;border-collapse:collapse;font-size:14px">
       <tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0d9488">Order no</th>
           <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0d9488">Contents</th>
           <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0d9488">Ship to</th></tr>
       ${bookRows}${goldRows}
     </table>`,
  );

  const ok = await sendEmail(warehouse, `📦 ${total} parcel(s) to dispatch`, html);
  if (ok) {
    const now = new Date().toISOString();
    if (list.length) await svc.from("book_orders").update({ warehouse_notified_at: now }).in("id", list.map((o) => o.id));
    if (goldList.length) await svc.from("orders").update({ warehouse_notified_at: now }).in("id", goldList.map((g) => g.id));
  }
  return { ok, count: total };
}
