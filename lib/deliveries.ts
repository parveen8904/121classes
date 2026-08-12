import { createServiceClient } from "@/lib/supabase/service";
import { courierLabel, trackingUrl } from "@/lib/courierTracking";

// A STUDENT'S PARCELS, IN ONE PLACE.
//
// Until now the courier name and tracking number went into the warehouse
// screen and stopped there. Three tables hold them — book orders, subject
// orders whose plan includes books, and gifts — and not one page outside
// /admin ever read any of them. The number was entered correctly, saved
// correctly, and shown to nobody.
//
// This is the read side. It answers one question: what has this person bought
// that travels in a van, and where is it.

export type Delivery = {
  id: string;
  orderNo: string;
  what: string;
  placedAt: string;
  courier: string;        // proper name, e.g. "XpressBees" from "Expressbee"
  tracking: string;
  trackUrl: string | null; // null = courier not recognised; show the number bare
  dispatched: boolean;
};

const itemsToText = (items: unknown): string => {
  if (!Array.isArray(items)) return "Books";
  const names = items
    .map((i) => (i && typeof i === "object" ? String((i as { title?: unknown }).title ?? "") : ""))
    .filter(Boolean);
  return names.length ? names.join(", ") : "Books";
};

/**
 * Every parcel belonging to one person, newest first. Matched on the user id in
 * all three tables, and on the email for book orders placed as a guest — a
 * student who bought books before signing in still owns that parcel.
 */
export async function deliveriesFor(userId: string, email: string | null): Promise<Delivery[]> {
  const svc = createServiceClient();
  const out: Delivery[] = [];

  const add = (
    id: string, orderNo: number | null, what: string, placedAt: string,
    courier: string | null, tracking: string | null, dispatched: boolean,
  ) => {
    out.push({
      id,
      orderNo: orderNo ? String(orderNo) : "—",
      what,
      placedAt,
      courier: courierLabel(courier),
      tracking: String(tracking ?? "").trim(),
      trackUrl: trackingUrl(courier, tracking),
      dispatched,
    });
  };

  // 1 — Book orders. Either signed in at the time, or matched later by email.
  const seen = new Set<string>();
  const takeBooks = (rows: unknown[]) => {
    for (const r of rows as {
      id: string; order_no: number | null; items: unknown; created_at: string;
      courier_name: string | null; tracking_code: string | null; status: string;
    }[]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      add(r.id, r.order_no, itemsToText(r.items), r.created_at, r.courier_name, r.tracking_code,
          r.status === "dispatched" || !!r.tracking_code);
    }
  };

  const bookCols = "id, order_no, items, created_at, courier_name, tracking_code, status";
  const { data: mine } = await svc
    .from("book_orders").select(bookCols)
    .eq("student_id", userId)
    .in("status", ["paid", "dispatched", "delivered"])
    .order("created_at", { ascending: false }).limit(100);
  takeBooks(mine ?? []);

  if (email) {
    // Bought before signing in: the buyer's address is inside guest_contact.
    const { data: guest } = await svc
      .from("book_orders").select(bookCols + ", guest_contact")
      .contains("guest_contact", { email })
      .in("status", ["paid", "dispatched", "delivered"])
      .order("created_at", { ascending: false }).limit(100);
    takeBooks(guest ?? []);
  }

  // 2 — A subject order whose plan includes the printed books.
  const { data: subj } = await svc
    .from("orders")
    .select("id, order_no, created_at, courier_name, tracking_code, subjects:subject_id(title)")
    .eq("student_id", userId)
    .not("tracking_code", "is", null)
    .order("created_at", { ascending: false }).limit(100);
  for (const o of (subj ?? []) as unknown as {
    id: string; order_no: number | null; created_at: string;
    courier_name: string | null; tracking_code: string | null; subjects: { title: string } | null;
  }[]) {
    add(o.id, o.order_no, `${o.subjects?.title ?? "Course"} — books`, o.created_at, o.courier_name, o.tracking_code, true);
  }

  // 3 — Books that arrived as somebody's gift.
  const { data: gifts } = await svc
    .from("gift_orders")
    .select("id, order_no, created_at, courier_name, tracking_code, subjects:subject_id(title)")
    .eq("recipient_user_id", userId)
    .not("tracking_code", "is", null)
    .order("created_at", { ascending: false }).limit(100);
  for (const g of (gifts ?? []) as unknown as {
    id: string; order_no: number | null; created_at: string;
    courier_name: string | null; tracking_code: string | null; subjects: { title: string } | null;
  }[]) {
    add(g.id, g.order_no, `${g.subjects?.title ?? "Course"} — books (a gift)`, g.created_at, g.courier_name, g.tracking_code, true);
  }

  return out.sort((a, b) => +new Date(b.placedAt) - +new Date(a.placedAt));
}
