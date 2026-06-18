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

// Email the warehouse the list of paid, not-yet-notified book orders, then
// stamp them. Returns a summary. Safe to call repeatedly (idempotent on the flag).
export async function runWarehouseDispatch(): Promise<{ ok: boolean; count: number; skipped?: string }> {
  const warehouse = process.env.WAREHOUSE_EMAIL;
  if (!warehouse || !(await emailConfigured())) {
    return { ok: true, count: 0, skipped: "email or WAREHOUSE_EMAIL not configured" };
  }

  const svc = createServiceClient();
  const { data: orders } = await svc
    .from("book_orders")
    .select("id, guest_contact, ship_to, items")
    .eq("status", "paid")
    .is("warehouse_notified_at", null)
    .order("created_at", { ascending: true });

  const list = (orders ?? []) as unknown as OrderRow[];
  if (!list.length) return { ok: true, count: 0 };

  const ids = [...new Set(list.flatMap((o) => (o.items ?? []).map((i) => i.book_id).filter(Boolean)))] as string[];
  const { data: books } = ids.length
    ? await svc.from("books").select("id, title").in("id", ids)
    : { data: [] as { id: string; title: string }[] };
  const titleById = new Map((books ?? []).map((b) => [b.id, b.title]));

  const rows = list
    .map((o) => {
      const s = o.ship_to ?? {};
      const items = (o.items ?? [])
        .map((i) => `${titleById.get(i.book_id ?? "") ?? "Book"} × ${i.qty ?? 1}`)
        .join(", ");
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${items}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${s.name ?? o.guest_contact?.name ?? ""}<br>${s.line1 ?? ""}${s.line2 ? ", " + s.line2 : ""}, ${s.city ?? ""}, ${s.state ?? ""} ${s.pincode ?? ""}<br>📞 ${s.phone ?? o.guest_contact?.phone ?? ""}</td>
      </tr>`;
    })
    .join("");

  const html = emailShell(
    `📦 Dispatch list — ${list.length} order${list.length === 1 ? "" : "s"}`,
    `<p>Please pack and ship the following orders (free shipping):</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px">
       <tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0d9488">Items</th>
           <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0d9488">Ship to</th></tr>
       ${rows}
     </table>`,
  );

  const ok = await sendEmail(warehouse, `📦 ${list.length} book order(s) to dispatch`, html);
  if (ok) {
    await svc
      .from("book_orders")
      .update({ warehouse_notified_at: new Date().toISOString() })
      .in("id", list.map((o) => o.id));
  }
  return { ok, count: list.length };
}
