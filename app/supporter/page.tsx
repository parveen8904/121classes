import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";
import SubmitButton from "@/app/components/SubmitButton";
import { addSupporterLead, removeSupporterLead } from "./actions";

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
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

type Gift = {
  id: string; recipient_name: string | null; recipient_email: string | null;
  recipient_attempt: string | null; tier: string | null; months: number | null;
  amount_inr: number | null; invoice_no: string | null; invoice_url: string | null;
  status: string; created_at: string; paid_at: string | null;
};

type Lead = {
  id: string; full_name: string; phone: string | null; email: string | null;
  level: string | null; note: string | null; status: string; created_at: string;
};

const LEAD_STATE: Record<string, string> = {
  new: "⏳ With the office",
  contacted: "📞 Contacted",
  gifted: "🎁 Gifted",
  declined: "— Not proceeding",
};

export default async function SupporterPage(props: {
  searchParams: Promise<{ added?: string; removed?: string; err?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles").select("full_name, email, is_supporter, role").eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin") redirect("/dashboard");

  const [{ data: giftRows }, { data: leadRows }] = await Promise.all([
    svc.from("gift_orders")
      .select("id, recipient_name, recipient_email, recipient_attempt, tier, months, amount_inr, invoice_no, invoice_url, status, created_at, paid_at")
      .eq("gifter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300),
    svc.from("supporter_leads")
      .select("id, full_name, phone, email, level, note, status, created_at")
      .eq("supporter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const { sellableProducts } = await import("@/lib/supporterCatalogue");
  const products = await sellableProducts();

  const gifts = (giftRows ?? []) as Gift[];
  const leads = (leadRows ?? []) as Lead[];

  // Only money actually taken counts. A started-but-abandoned checkout is not a
  // gift, and showing it as one would overstate what he has given.
  const paid = gifts.filter((g) => g.status === "provisioned" || g.status === "paid");
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
        {sp.added && <div className="notice ok" style={{ marginTop: 14 }}>✅ Noted. Our office will reach out to them and set the gift up with you.</div>}
        {sp.removed && <div className="notice ok" style={{ marginTop: 14 }}>✅ Removed from your list.</div>}

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
          <div className="admin-tile">
            <div className="tile-ic">📝</div>
            <h3 style={{ fontSize: "1.6rem" }}>{leads.filter((l) => l.status === "new").length}</h3>
            <p>waiting with our office</p>
          </div>
        </div>

        {/* ── The students ──────────────────────────────────────────────── */}
        <h2 className="admin-section-title" style={{ marginTop: 32 }}>🧾 Your orders</h2>
        {paid.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Nothing yet. <Link href="/gift">Sponsor a student</Link> — or add a name below and we will set it up
              with you.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {paid.map((g) => (
              <div className="list-row" key={g.id} style={{ flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="row-title">🧑‍🎓 {g.recipient_name || "Student"}</span>
                  <p className="row-sub">
                    {g.recipient_attempt ? `${g.recipient_attempt} · ` : ""}
                    {g.tier ? `${g.tier}` : "plan"}{g.months ? ` · ${g.months} months` : ""} · {day(g.paid_at || g.created_at)}
                  </p>
                </div>
                <div className="row-actions" style={{ alignItems: "center", gap: 10 }}>
                  <strong>{inr(Number(g.amount_inr || 0))}</strong>
                  {g.invoice_url ? (
                    <a className="btn small secondary" href={viaProxy(g.invoice_url)} target="_blank" rel="noopener noreferrer">
                      🧾 Invoice{g.invoice_no ? ` ${g.invoice_no}` : ""}
                    </a>
                  ) : (
                    <span className="muted" style={{ fontSize: ".8rem" }}>invoice on its way</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Who they intend to sponsor ────────────────────────────────── */}
        <h2 className="admin-section-title" style={{ marginTop: 32 }}>📝 Students you would like to sponsor</h2>
        <p className="muted" style={{ fontSize: ".9rem", margin: "4px 0 12px", lineHeight: 1.6 }}>
          Add anyone you are thinking of helping. Our office contacts them, checks they are genuine, and comes back
          to you before anything is charged — nothing here is a payment.
        </p>

        <form action={addSupporterLead} className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div>
              <label>Student&apos;s name</label>
              <input name="full_name" required placeholder="Full name" />
            </div>
            <div>
              <label>Which exam?</label>
              <select name="level" defaultValue="">
                <option value="">Not sure yet</option>
                <option value="CA Intermediate">CA Intermediate</option>
                <option value="CA Final">CA Final</option>
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div>
              <label>Phone</label>
              <input name="phone" inputMode="tel" placeholder="10-digit mobile" />
            </div>
            <div>
              <label>Email</label>
              <input name="email" type="email" placeholder="name@example.com" />
            </div>
          </div>
          <div>
            <label>Anything we should know <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}>— optional</span></label>
            <textarea name="note" rows={2} placeholder="e.g. Second attempt, cannot afford coaching. Known to me personally." />
          </div>
          <div>
            <SubmitButton className="btn">➕ Add this student</SubmitButton>
          </div>
        </form>

        {leads.length > 0 && (
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {leads.map((l) => (
              <div className="list-row" key={l.id} style={{ flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="row-title">{l.full_name}</span>
                  <p className="row-sub">
                    {[l.level, l.phone, l.email].filter(Boolean).join(" · ") || "no contact details"}
                    {l.note ? ` — ${l.note}` : ""}
                  </p>
                </div>
                <div className="row-actions" style={{ alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: ".82rem", fontWeight: 700 }}>{LEAD_STATE[l.status] ?? l.status}</span>
                  {l.status === "new" && (
                    <form action={removeSupporterLead}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn small secondary">Remove</SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            ))}
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
