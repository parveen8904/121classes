import { formatDate } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import OrderList, { OrderSearch, orderMatches, type SupporterOrder } from "./OrderList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supporter — CA Parveen Sharma" };

// The supporter's own room.
//
// Someone who has paid for thirty students to study here had no way to see the
// thirty. The gifts existed only as orders in our admin, the invoices only in
// his own email, and the students he MEANT to sponsor next existed only in a
// phone call. All three live here now, and nothing on this page is anybody
// else's business — it is scoped to the person signed in.

const inr = (n: number) => "₹" + (Math.round(n) || 0).toLocaleString("en-IN");
const day = (s: string | null) =>
  s ? formatDate(s) : "—";

type Gift = SupporterOrder;

// The desk shows the most recent fifty. A vendor with three hundred orders does
// not scroll a desk — they search, or they open the full list.
const ON_THE_DESK = 50;

export default async function SupporterPage(props: {
  searchParams: Promise<{ err?: string; q?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles").select("full_name, email, is_supporter, role").eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin") redirect("/dashboard");

  const { data: giftRows } = await svc.from("gift_orders")
    .select("id, order_no, recipient_name, recipient_email, recipient_phone, recipient_address, recipient_attempt, tier, months, amount_inr, invoice_no, invoice_url, status, created_at, paid_at, subjects:subject_id(title, courses(title))")
    .eq("gifter_id", user.id)
    .order("created_at", { ascending: false })
    .limit(300);

  const { sellableProducts } = await import("@/lib/supporterCatalogue");
  const products = await sellableProducts();

  // PostgREST types an embedded table as an array; the row shape treats a
  // single related row as an object. Both are true at runtime, so the cast
  // goes through unknown rather than pretending the two agree.
  const gifts = ((giftRows ?? []) as unknown) as Gift[];

  // Only money actually taken counts. A started-but-abandoned checkout is not a
  // gift, and showing it as one would overstate what he has given.
  const paid = gifts.filter((g) => g.status === "provisioned" || g.status === "paid");
  // Searching looks through everything they have sold; without a search the
  // desk shows the newest fifty and offers the rest on their own page.
  const found = sp.q ? paid.filter((g) => orderMatches(g, sp.q!)) : paid;
  const shown = sp.q ? found : found.slice(0, ON_THE_DESK);
  const totalPaid = paid.reduce((s, g) => s + Number(g.amount_inr || 0), 0);
  const thisYear = paid.filter((g) => new Date(g.paid_at || g.created_at).getFullYear() === new Date().getFullYear());
  const yearPaid = thisYear.reduce((s, g) => s + Number(g.amount_inr || 0), 0);

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 900 }}>
        <span className="badge">💚 Supporter</span>
        <h1 style={{ margin: "12px 0 6px" }}>
          {me?.full_name ? `${me.full_name.split(" ")[0]}'s` : "Your"} desk
        </h1>
        <p className="muted" style={{ fontSize: "1rem", lineHeight: 1.7 }}>
          What you can sell, what you have sold, and every invoice — in one place.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <Link className="btn small" href="/supporter/sell">🛒 Place an order</Link>
          <Link className="btn small secondary" href="/supporter/profile">👤 My details &amp; GST</Link>
          <Link className="btn small secondary" href="/supporter/terms">📋 How this works</Link>
          <Link className="btn small secondary" href="/supporter/complaint">🚩 Report a seller</Link>
          {/* There was no way out of this portal at all. A supporter selling
              from a shared or shop counter had to clear the browser to end
              their session — on a desk where the next person may be a student. */}
          <a className="btn small secondary" href="/auth/signout" style={{ marginLeft: "auto" }}>
            ↪ Log out
          </a>
        </div>

        {/* WHAT YOU SELL. Two products, priced exactly as a student would pay.
            The discount a supporter passes on comes from a coupon, openly, not
            from a second price list. */}
        <h2 className="admin-section-title" style={{ marginTop: 26 }}>🛒 What you can sell</h2>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          {products.map((p) => (
            <div className="card" key={p.id}>
              <strong style={{ fontSize: "1.02rem" }}>{p.title}</strong>
              <p className="muted" style={{ margin: "4px 0 10px", fontSize: ".86rem" }}>
                {p.course} · Gold · {p.months} months · printed books included
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <strong style={{ fontSize: "1.15rem" }}>{inr(p.priceInr)}</strong>
                <Link className="btn small" href={`/supporter/sell?subject=${p.id}`}>Place an order →</Link>
              </div>
            </div>
          ))}
          {products.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing is available to sell right now — please call the office.</p></div>
          )}
        </div>

        {sp.err && <div className="notice err" style={{ marginTop: 14 }}>⚠️ {sp.err}</div>}

        <div className="admin-cards" style={{ marginTop: 20, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div className="admin-tile">
            <div className="tile-ic">🎓</div>
            <h3 style={{ fontSize: "1.6rem" }}>{paid.length}</h3>
            <p>subscription{paid.length === 1 ? "" : "s"} you have sold</p>
          </div>
          <div className="admin-tile">
            <div className="tile-ic">💰</div>
            <h3 style={{ fontSize: "1.6rem" }}>{inr(totalPaid)}</h3>
            <p>business in total</p>
          </div>
          <div className="admin-tile">
            <div className="tile-ic">📅</div>
            <h3 style={{ fontSize: "1.6rem" }}>{inr(yearPaid)}</h3>
            <p>business this year</p>
          </div>
        </div>

        {/* ── The students ──────────────────────────────────────────────── */}
        <h2 className="admin-section-title" style={{ marginTop: 32 }}>🧾 Your orders ({paid.length})</h2>
        <OrderSearch defaultValue={sp.q} action="/supporter" />
        {sp.q && (
          <p className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
            {found.length === 0
              ? `Nothing matches “${sp.q}”. Try the order number, or the student's email or phone.`
              : `${found.length} order${found.length === 1 ? "" : "s"} matching “${sp.q}”.`}
          </p>
        )}
        <OrderList orders={shown} />
        {!sp.q && found.length > ON_THE_DESK && (
          <div style={{ marginTop: 14 }}>
            <Link className="btn small secondary" href="/supporter/orders">
              See all your orders ({found.length}) →
            </Link>
          </div>
        )}

        <p className="muted" style={{ fontSize: ".85rem", marginTop: 28 }}>
          Every student you sponsor gets the full course, the day-by-day plan and their papers checked — the same as
          any paying student. They are never told what was paid.
        </p>
      </section>
    </main>
  );
}
