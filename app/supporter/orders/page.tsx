import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { selectAll } from "@/lib/pageAll";
import OrderList, { OrderSearch, orderMatches, type SupporterOrder } from "../OrderList";

export const dynamic = "force-dynamic";
export const metadata = { title: "All your orders — Supporter" };

// EVERY ORDER THIS VENDOR HAS EVER PLACED.
//
// Their desk shows the newest fifty, which is a desk. This is the ledger: all
// of them, oldest included, with the same search. Read in pages rather than one
// query, because a vendor who has sold two thousand courses would otherwise
// silently receive the first thousand and believe that was all of them.

const inr = (n: number) => "₹" + (Math.round(n) || 0).toLocaleString("en-IN");

export default async function SupporterAllOrders(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter/orders");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles").select("is_supporter, role").eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin" && me?.role !== "supporter") redirect("/dashboard");

  const rows = await selectAll<SupporterOrder>((from, to) =>
    svc.from("gift_orders")
      .select("id, order_no, recipient_name, recipient_email, recipient_phone, recipient_address, recipient_attempt, tier, months, amount_inr, invoice_no, invoice_url, status, created_at, paid_at, subjects:subject_id(title, courses(title))")
      .eq("gifter_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, to) as never,
  );

  // Money actually taken. A started-and-abandoned checkout is not an order and
  // showing it here would have a vendor chasing a student who never bought.
  const paid = rows.filter((g) => g.status === "provisioned" || g.status === "paid");
  const found = sp.q ? paid.filter((g) => orderMatches(g, sp.q!)) : paid;
  const total = found.reduce((s, g) => s + Number(g.amount_inr ?? 0), 0);

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 70, maxWidth: 900 }}>
        <p className="crumb"><Link href="/supporter">← My desk</Link></p>
        <span className="badge">🧾 All your orders</span>
        <h1 style={{ margin: "12px 0 6px" }}>Everything you have sold</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          {paid.length} order{paid.length === 1 ? "" : "s"} in all. Search by order number, or by the student&apos;s
          email or phone number — whichever they give you when they ring.
        </p>

        <OrderSearch defaultValue={sp.q} action="/supporter/orders" />

        <p className="muted" style={{ fontSize: ".85rem" }}>
          {sp.q
            ? found.length === 0
              ? `Nothing matches “${sp.q}”.`
              : `${found.length} order${found.length === 1 ? "" : "s"} · ${inr(total)}`
            : `${found.length} order${found.length === 1 ? "" : "s"} · ${inr(total)}`}
        </p>

        <OrderList orders={found} />
      </section>
    </main>
  );
}
