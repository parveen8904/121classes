import { formatDate } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import OrderList, { OrderSearch, orderMatches, type SupporterOrder } from "./OrderList";
import PenaltyPay from "./PenaltyPay";

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
  searchParams: Promise<{ err?: string; q?: string; as?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter");

  const svc = createServiceClient();
  // Written out in full at each call. PostgREST types the select string at
  // COMPILE time, so a constant or a template literal makes every column come
  // back as an error type — the same trap that bit the gift order gate.
  const { data: signedIn } = await svc
    .from("profiles")
    .select("full_name, business_name, email, is_supporter, role, supporter_blocked_at, supporter_block_reason, supporter_hold_auto, supporter_hold_evidence, supporter_penalty_inr")
    .eq("id", user.id).maybeSingle();
  const isAdmin = signedIn?.role === "admin";
  if (!signedIn?.is_supporter && !isAdmin) redirect("/dashboard");

  // LOOKING AT A VENDOR'S DESK WITHOUT BECOMING THEM.
  //
  // The office is asked "what does my desk show?" and until now the only way to
  // answer was to ask the vendor for their password, which is the one thing
  // nobody should ever be asked for. ?as=<id> shows an admin exactly what that
  // vendor sees — their orders, their totals, their hold if they have one.
  //
  // ADMIN ONLY, and enforced here rather than by hiding the dropdown: a vendor
  // who types another vendor's id into the address bar gets their own desk
  // back, not somebody else's book of business.
  const viewingId = isAdmin ? String(sp.as ?? "").trim() : "";
  const { data: viewed } = viewingId
    ? await svc.from("profiles")
        .select("full_name, business_name, email, is_supporter, role, supporter_blocked_at, supporter_block_reason, supporter_hold_auto, supporter_hold_evidence, supporter_penalty_inr")
        .eq("id", viewingId).maybeSingle()
    : { data: null };
  const me = (viewed ?? signedIn) as typeof signedIn;
  const deskOwnerId = viewed ? viewingId : user.id;

  // The list for the dropdown — only built for an admin, and only names.
  const { data: allSellers } = isAdmin
    ? await svc.from("profiles").select("id, full_name, business_name, supporter_blocked_at")
        .or("is_supporter.eq.true,role.eq.supporter").order("business_name", { nullsFirst: false }).limit(500)
    : { data: null };

  const { data: giftRows } = await svc.from("gift_orders")
    .select("id, order_no, recipient_name, recipient_email, recipient_phone, recipient_address, recipient_attempt, tier, months, amount_inr, invoice_no, invoice_url, status, created_at, paid_at, subjects:subject_id(title, courses(title))")
    .eq("gifter_id", deskOwnerId)
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
          {/* While reading another vendor's desk these are hidden, not merely
              warned about. "Place an order" here would place it under the
              admin's OWN account — a quiet way to create a real sale against
              the wrong seller while believing you were browsing. */}
          {!viewed && <Link className="btn small" href="/supporter/sell">🛒 Place an order</Link>}
          {!viewed && <Link className="btn small secondary" href="/supporter/profile">👤 My details &amp; GST</Link>}
          <Link className="btn small secondary" href="/supporter/terms">📋 How this works</Link>
          <Link className="btn small secondary" href="/supporter/complaint">🚩 Report a seller</Link>
          {/* There was no way out of this portal at all. A supporter selling
              from a shared or shop counter had to clear the browser to end
              their session — on a desk where the next person may be a student. */}
          <a className="btn small secondary" href="/auth/signout" style={{ marginLeft: "auto" }}>
            ↪ Log out
          </a>
        </div>

        {/* WHOSE DESK AM I LOOKING AT.
            Shown to an admin only. When it is somebody else's, the band says so
            in a colour that cannot be mistaken for the ordinary screen — an
            admin who forgets they are looking through another vendor's eyes
            will read their totals as the business's own. */}
        {allSellers && (
          <div
            className="card"
            style={{
              marginTop: 14,
              borderLeft: `4px solid ${viewed ? "#7c3aed" : "var(--border)"}`,
              background: viewed ? "rgba(124,58,237,.07)" : undefined,
            }}
          >
            <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <label htmlFor="asv" style={{ fontSize: ".78rem" }}>
                  {viewed ? "👁️ You are looking at another vendor's desk" : "👁️ Look at a vendor's desk"}
                </label>
                <select id="asv" name="as" defaultValue={viewingId} style={{ marginBottom: 0 }}>
                  <option value="">— my own desk —</option>
                  {(allSellers as { id: string; full_name: string | null; business_name: string | null; supporter_blocked_at: string | null }[])
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.business_name || v.full_name || v.id}
                        {v.supporter_blocked_at ? "  ·  ON HOLD" : ""}
                      </option>
                    ))}
                </select>
              </div>
              <button className="btn small" type="submit">Show me</button>
              {viewed && <Link className="btn small secondary" href="/supporter">Back to my own</Link>}
            </form>
            {viewed && (
              <p className="muted" style={{ fontSize: ".82rem", lineHeight: 1.7, margin: "10px 0 0" }}>
                Everything below is <strong>{(me?.business_name as string) || (me?.full_name as string) || "this vendor"}</strong>&apos;s
                — their orders, their totals, their hold. You are reading it, not acting as them: nothing you press
                here places an order or takes a payment on their behalf.
              </p>
            )}
          </div>
        )}

        {/* THE HOLD, ABOVE EVERYTHING THEY CAN DO.
            A vendor who finds out about a hold by failing to place an order has
            wasted a student's details and their own evening. It goes first. */}
        {me?.supporter_blocked_at ? (
          <div style={{ marginTop: 18 }}>
            <PenaltyPay
              reason={(me.supporter_block_reason as string) ?? null}
              evidence={(me.supporter_hold_evidence as string) ?? null}
              amountInr={Number(me.supporter_penalty_inr) || 5000}
              auto={Boolean(me.supporter_hold_auto)}
            />
          </div>
        ) : null}

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
                {viewed
                  ? <span className="muted" style={{ fontSize: ".82rem" }}>viewing only</span>
                  : <Link className="btn small" href={`/supporter/sell?subject=${p.id}`}>Place an order →</Link>}
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
