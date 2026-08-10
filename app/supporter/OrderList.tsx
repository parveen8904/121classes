import { formatDate } from "@/lib/dates";
import Link from "next/link";
import { viaProxy } from "@/lib/fileProxy";

// WHAT A VENDOR NEEDS TO SEE ABOUT AN ORDER THEY PLACED.
//
// A student rings them, not us: "I paid you last month and I still cannot open
// Financial Reporting." The vendor then needs to find that one order among
// hundreds, and the only things they will have to hand are the student's phone
// number, their email, or an order number off an invoice. So all three are
// shown on every row, and all three are searchable.
//
// Used twice — the last fifty on their desk, and every one of them on the full
// list — so the two can never drift apart into different-looking pages.

export type SupporterOrder = {
  id: string;
  order_no: number | null;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_attempt: string | null;
  tier: string | null;
  months: number | null;
  amount_inr: number | null;
  invoice_no: string | null;
  invoice_url: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  subjects: { title: string | null; courses?: { title?: string } | { title?: string }[] | null } | null;
};

const inr = (n: number | null) => "₹" + (Math.round(n ?? 0) || 0).toLocaleString("en-IN");
const day = (s: string | null) =>
  s ? formatDate(s) : "—";

/** CA Final / CA Intermediate — the category the subject sits in. */
export function categoryOf(o: SupporterOrder): string {
  const c = o.subjects?.courses;
  return (Array.isArray(c) ? c[0]?.title : c?.title) ?? "";
}

/** The order number as the vendor sees it on the invoice. */
export function orderIdOf(o: SupporterOrder): string {
  return o.order_no != null ? `#${o.order_no}` : o.invoice_no ?? "";
}

/**
 * Does this order answer what they typed?
 *
 * Order number, email and phone are matched loosely on purpose: they will type
 * "10023" for #10023, and a phone with spaces or a +91 in front of it.
 */
export function orderMatches(o: SupporterOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  const phone = (o.recipient_phone ?? "").replace(/\D/g, "");
  if (digits.length >= 6 && phone && phone.endsWith(digits.slice(-10))) return true;
  return [
    o.order_no != null ? String(o.order_no) : "",
    orderIdOf(o), o.invoice_no ?? "",
    o.recipient_name ?? "", o.recipient_email ?? "", o.recipient_phone ?? "",
    o.subjects?.title ?? "", categoryOf(o),
  ].some((v) => v.toLowerCase().includes(q));
}

export default function OrderList({ orders }: { orders: SupporterOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Nothing here — <Link href="/supporter/sell">place an order</Link>.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {orders.map((o) => {
        const category = categoryOf(o);
        return (
          <div className="list-row" key={o.id} style={{ flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="row-title">
                {orderIdOf(o) && <span className="muted" style={{ fontWeight: 700 }}>{orderIdOf(o)} · </span>}
                🧑‍🎓 {o.recipient_name || "Student"}
              </span>
              <p className="row-sub" style={{ lineHeight: 1.7 }}>
                {category && <>📚 {category} · </>}
                📘 {o.subjects?.title ?? "—"}
                {o.tier ? ` · ${o.tier.charAt(0).toUpperCase()}${o.tier.slice(1)}` : ""}
                {o.months ? ` · ${o.months} months` : ""}
                {o.recipient_attempt ? ` · ${o.recipient_attempt}` : ""}
                <br />
                {/* The two things a vendor is asked for on the phone. */}
                ✉️ {o.recipient_email || "no email"} · 📞 {o.recipient_phone || "no number"}
                <br />
                {day(o.paid_at || o.created_at)}
              </p>
            </div>
            <div className="row-actions" style={{ alignItems: "center", gap: 10 }}>
              <strong>{inr(o.amount_inr)}</strong>
              {o.invoice_url ? (
                <a className="btn small secondary" href={viaProxy(o.invoice_url)} target="_blank" rel="noopener noreferrer">
                  🧾 Invoice{o.invoice_no ? ` ${o.invoice_no}` : ""}
                </a>
              ) : (
                <span className="muted" style={{ fontSize: ".8rem" }}>invoice on its way</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One search box, the same on both pages. */
export function OrderSearch({ defaultValue, action }: { defaultValue?: string; action: string }) {
  return (
    <form action={action} style={{ display: "flex", gap: 8, maxWidth: 520, margin: "10px 0 14px" }}>
      <input
        name="q"
        defaultValue={defaultValue ?? ""}
        placeholder="🔍 Order number, student email or phone"
        style={{ marginBottom: 0 }}
      />
      <button className="btn small" type="submit">Search</button>
      {defaultValue ? <Link className="btn small secondary" href={action}>Clear</Link> : null}
    </form>
  );
}
