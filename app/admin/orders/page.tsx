import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { formatINR } from "@/lib/pricing";
import { viaProxy } from "@/lib/fileProxy";
import AdminHero from "../_components/AdminHero";
import { setOrderStatus, sendDispatchEmail, generateInvoice, reissueInvoice, reissueBookInvoice, adminConfirmPayment } from "./actions";
import SelectAll from "./SelectAll";
import FilterReset from "./FilterReset";
import { inChunks } from "@/lib/pageAll";
import { ORDER_STATES, chosenStates, matchesState } from "@/lib/orderStatus";

// Zoho posting state → what the admin sees in the register. Normal flow is
// the one-click DAY approval above the table; per-row buttons are for
// exceptions (hold something fishy, or approve one sale early).
function ZohoCell({ status, paid = true }: { id?: string; table?: string; status: string | null; paid?: boolean }) {
  // AN UNPAID ORDER HAS NO BUSINESS IN THE BOOKS. Fifty-four abandoned
  // checkouts were each carrying a Zoho state, which is noise on rows where no
  // entry should ever exist.
  if (!paid) return <span className="muted" title="Nothing was paid, so there is nothing to book">—</span>;
  // WHERE THE SALE STANDS IN THE BOOKS — never where the PAYMENT stands.
  //
  // This column used to say a bare "— pending" beside an order marked paid,
  // which reads as though the student still owes money. The money is in; what
  // is pending is the entry. It now says which.
  //
  // "Posts tonight" was also no longer true: the nightly run stopped posting on
  // its own when the founder ruled that nothing reaches Zoho without him, so an
  // approved sale now waits at his gate rather than going in at 3:30 am.
  if (status === "posted") return <span title="This sale is in Zoho Books">✅ in Zoho</span>;
  if (status === "approved") return <span className="muted" title="The accounts desk has approved it; it posts when CA Parveen Sharma releases it on the books desk">⏳ with CA Parveen Sharma</span>;
  if (status === "skipped") return <span title="Held on the Accounts page — this will not post">🚫 held out of Zoho</span>;
  return <span className="muted" title="Paid, but not yet approved for Zoho — the accounts desk approves it on the Accounts page">📗 not in Zoho yet</span>;
}

type Ship = { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; phone?: string };
type Contact = { name?: string; email?: string; phone?: string };
type Item = { book_id?: string; qty?: number; price_inr?: number };
type OrderRow = {
  id: string;
  amount_inr: number;
  status: string;
  created_at: string;
  guest_contact: Contact | null;
  ship_to: Ship | null;
  items: Item[] | null;
  zoho_status?: string | null;
  order_no?: number | null;
  tracking_code?: string | null;
};

const STATUS_EMOJI: Record<string, string> = {
  paid: "🟡 paid",
  dispatched: "🚚 dispatched",
  delivered: "✅ delivered",
  cancelled: "❌ cancelled",
};

function fmt(s: string): string {
  return formatDate(s);
}

type PayRow = {
  id: string; kind: string; amount_inr: number; status: string; created_at: string;
  razorpay_order_id: string | null; invoice_no: string | null; invoice_url: string | null;
  zoho_status: string | null; subject_id: string | null; order_no: number | null;
  subjects: { title: string; courses?: { title?: string } | { title?: string }[] | null } | null;
  profiles: {
    id: string; full_name: string | null; email: string | null; phone: string | null;
    address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; pincode: string | null;
  } | null;
};

type GiftRow = {
  id: string; amount_inr: number; discount_inr: number | null; coupon_code: string | null;
  status: string; created_at: string; razorpay_order_id: string | null;
  invoice_no: string | null; invoice_url: string | null; order_no: number | null;
  months: number | null; tier: string | null; subject_id: string | null;
  recipient_name: string | null; recipient_email: string | null; recipient_phone: string | null;
  billing_name: string | null;
  subjects: { title: string; courses?: { title?: string } | { title?: string }[] | null } | null;
  gifter: { full_name: string | null; email: string | null; business_name: string | null; designation: string | null; is_supporter: boolean | null } | null;
};

const TIER_ICON: Record<string, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whole months between two dates — used when months_total was never recorded. */
function monthsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const from = new Date(a), to = new Date(b);
  const m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return m > 0 ? m : null;
}

export default async function AdminOrdersPage(
  props: {
    searchParams: Promise<{ confirmed?: string; confirmerr?: string; dispatch?: string; q?: string; from?: string; to?: string; status?: string; source?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const q = (searchParams.q ?? "").trim().toLowerCase();
  // Date range, entered as IST calendar days. "To" covers the whole day, so
  // picking the same date twice gives exactly that one day's sales.
  const okDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const fromDay = okDate(searchParams.from);
  const toDay = okDate(searchParams.to);
  const fromIso = fromDay ? new Date(`${fromDay}T00:00:00+05:30`).toISOString() : null;
  const toIso = toDay ? new Date(`${toDay}T23:59:59+05:30`).toISOString() : null;
  // WHICH ORDERS TO SHOW — and to download.
  //
  // These boxes only ever changed the download. Tick "Paid", press Search, and
  // the list underneath still showed every order including the abandoned ones,
  // so the page said one thing and the spreadsheet another.
  //
  // "provisioned" is gone from the choices: it was our word, not his, and it
  // meant a supporter sale that went through — which is what "Paid" means.
  // See lib/orderStatus.ts for how each table is asked in its own vocabulary.
  const STATUSES = ORDER_STATES;
  const chosen = chosenStates(searchParams.status);

  const rangeQs = new URLSearchParams();
  if (fromDay) rangeQs.set("from", fromDay);
  if (toDay) rangeQs.set("to", toDay);
  // "Show me only what the vendors sold" — the office ask of 20 August. The
  // toggle rides into the download too, so screen and spreadsheet agree.
  const vendorOnly = searchParams.source === "vendor";
  const exportQs = new URLSearchParams(rangeQs);
  if (chosen.length) exportQs.set("status", chosen.join(","));
  if (vendorOnly) exportQs.set("source", "vendor");
  const supabase = createClient();
  const svc = createServiceClient();

  // A search should find an order however old it is, not just within the recent
  // screenful. So when there is a search term we scan far more history; the
  // normal, unsearched view stays capped for speed.
  const rowCap = q ? 20000 : 500;

  const [{ data }, { data: payData }, { data: giftData }] = await Promise.all([
    (() => {
      let qy = supabase
        .from("book_orders")
        .select("id, amount_inr, status, created_at, guest_contact, ship_to, items, invoice_no, invoice_url, zoho_status, order_no, tracking_code");
      if (fromIso) qy = qy.gte("created_at", fromIso);
      if (toIso) qy = qy.lte("created_at", toIso);
      return qy.order("created_at", { ascending: false }).limit(rowCap);
    })(),
    // ALL website payments (subscriptions / extensions / gifts) — OUR sales register.
    (() => {
      let qy = svc
        .from("orders")
        .select("id, kind, amount_inr, status, created_at, razorpay_order_id, invoice_no, invoice_url, zoho_status, subject_id, order_no, subjects:subject_id(title, courses(title)), profiles:student_id(id, full_name, email, phone, address_line1, address_line2, city, state, pincode)");
      if (fromIso) qy = qy.gte("created_at", fromIso);
      if (toIso) qy = qy.lte("created_at", toIso);
      return qy.order("created_at", { ascending: false }).limit(rowCap);
    })(),
    // SUPPORTER ORDERS. A supporter selling from their own desk writes to
    // gift_orders, which this page never read — so an order placed through the
    // supporter portal was taken, paid for and invoiced, and still did not
    // appear in the sales register. It is a sale like any other.
    (() => {
      let qy = svc
        .from("gift_orders")
        .select("id, amount_inr, discount_inr, coupon_code, status, created_at, razorpay_order_id, invoice_no, invoice_url, order_no, months, tier, subject_id, recipient_name, recipient_email, recipient_phone, billing_name, subjects:subject_id(title, courses(title)), gifter:gifter_id(full_name, email, business_name, designation, is_supporter)");
      if (fromIso) qy = qy.gte("created_at", fromIso);
      if (toIso) qy = qy.lte("created_at", toIso);
      return qy.order("created_at", { ascending: false }).limit(rowCap);
    })(),
  ]);

  // WHICH COURSE THIS ORDER IS FOR — read from the order itself.
  //
  // The level used to be looked up from my_courses: every course the STUDENT
  // holds, collapsed to one word. So a student who had bought CA Inter earlier
  // and then bought CA Final Financial Reporting had that order labelled
  // "Inter" beside the subject "Financial Reporting" — order 10017 exactly.
  // The order knows its own subject, and the subject knows its course.
  const levelOfOrder = (p: PayRow): string => {
    const c = p.subjects?.courses;
    const title = ((Array.isArray(c) ? c[0]?.title : c?.title) ?? "").toLowerCase();
    if (title.includes("final")) return "Final";
    if (title.includes("inter")) return "Inter";
    if (title.includes("foundation")) return "Foundation";
    return "";
  };

  // VENDOR/GIFT VALIDITY. A gift/vendor order provisions the subscription under
  // the RECIPIENT's own student account (found by email), not under the buyer.
  // The row was built with a synthetic profile id of "", so the start→end lookup
  // — keyed by the real student id — never matched and the validity read
  // "— → —". Resolve each recipient's real id here so their dates are found.
  const giftEmails = [...new Set(((giftData ?? []) as { recipient_email: string | null }[])
    .map((g) => String(g.recipient_email ?? "").toLowerCase()).filter(Boolean))];
  const giftRecipByEmail = new Map<string, string>(); // lower(email) → student id
  if (giftEmails.length) {
    const recips = await inChunks<{ id: string; email: string | null }>(
      giftEmails, (b) => svc.from("profiles").select("id, email").in("email", b) as never,
    );
    for (const r of recips) if (r.email) giftRecipByEmail.set(String(r.email).toLowerCase(), String(r.id));
  }

  // The exact subscription dates each payment created.
  const payRowsRaw = (payData ?? []) as unknown as PayRow[];
  // Payer ids from the direct orders PLUS the gift/vendor recipients, so the
  // subscription-date fetch below covers the students a vendor bought for.
  const payerIds = [...new Set([
    ...payRowsRaw.map((p) => p.profiles?.id).filter(Boolean) as string[],
    ...giftRecipByEmail.values(),
  ])];
  const levelByUser = new Map<string, string>();
  // Tier and length travel with the dates now: "Gold · 12 months" answers
  // "what did they actually buy" without opening the invoice.
  const subDates = new Map<string, { starts_at: string | null; ends_at: string | null; tier: string | null; months: number | null }>();
  if (payerIds.length) {
    const [{ data: mc }, { data: subRows }] = await Promise.all([
      // In batches — see lib/pageAll. A refused .in() blanks the level and
      // subscription-date columns for every payer at once.
      inChunks<{ student_id: string; courses?: { title?: string } | null }>(
        payerIds, (b) => svc.from("my_courses").select("student_id, courses(title)").in("student_id", b) as never,
      ).then((data) => ({ data })),
      inChunks<{ student_id: string; subject_id: string | null; starts_at: string | null; ends_at: string | null; created_at: string; months_total: number | null; plans?: { tier?: string } | null }>(
        payerIds, (b) => svc.from("subscriptions").select("student_id, subject_id, starts_at, ends_at, created_at, months_total, plans(tier)").in("student_id", b).order("created_at") as never,
      ).then((data) => ({ data })),
    ]);
    for (const r of mc ?? []) {
      const t = ((r as { courses?: { title?: string } | null }).courses?.title ?? "").toLowerCase();
      const lvl = t.includes("final") ? "Final" : t.includes("inter") ? "Inter" : "";
      if (!lvl) continue;
      const cur = levelByUser.get(r.student_id as string);
      levelByUser.set(r.student_id as string, cur && cur !== lvl ? "Final + Inter" : lvl);
    }
    // Later rows overwrite earlier ones → each student+subject keeps its latest dates.
    for (const s of subRows ?? []) {
      subDates.set(`${s.student_id}:${s.subject_id}`, {
        starts_at: s.starts_at as string | null,
        ends_at: s.ends_at as string | null,
        tier: s.plans?.tier ?? null,
        // Not every row records its length, so it is worked out from the dates
        // when missing rather than left blank.
        months: s.months_total ?? monthsBetween(s.starts_at as string | null, s.ends_at as string | null),
      });
    }
  }

  // Folded into the payment list rather than shown apart: the founder reads one
  // register, and a sale is a sale whoever keyed it in.
  // WHICH BOOKS. "1 item" told the office nothing — it could not see whether a
  // parcel was Inter or Final without opening the invoice. The titles carry the
  // level, so they are joined here and printed on the card.
  const bookIds = [...new Set(
    ((data ?? []) as { items?: { book_id?: string }[] | null }[])
      .flatMap((o) => (o.items ?? []).map((i) => i.book_id).filter(Boolean) as string[]),
  )];
  const { data: bookRows } = bookIds.length
    ? await svc.from("books").select("id, title").in("id", bookIds)
    : { data: [] as { id: string; title: string }[] };
  const bookTitle = new Map((bookRows ?? []).map((b) => [b.id as string, b.title as string]));

  const giftRows = ((giftData ?? []) as unknown as GiftRow[]).map((g): PayRow & { viaSupporter: string; viaDesignation: string | null; source: "vendor" | "sponsored"; discount: number | null; coupon: string | null; tier?: string | null; months?: number | null } => ({
    id: g.id,
    kind: "supporter",
    amount_inr: g.amount_inr,
    status: g.status,
    created_at: g.created_at,
    razorpay_order_id: g.razorpay_order_id,
    invoice_no: g.invoice_no,
    invoice_url: g.invoice_url,
    zoho_status: null,
    subject_id: g.subject_id,
    order_no: g.order_no,
    subjects: g.subjects,
    profiles: {
      // The recipient's REAL id (by email) so the subscription-date lookup below
      // matches; "" only if we truly cannot find their account.
      id: giftRecipByEmail.get(String(g.recipient_email ?? "").toLowerCase()) ?? "",
      full_name: g.recipient_name, email: g.recipient_email, phone: g.recipient_phone,
      address_line1: null, address_line2: null, city: null, state: null, pincode: null,
    },
    viaSupporter: g.gifter?.business_name || g.gifter?.full_name || g.gifter?.email || "a supporter",
    // Their contact person's job, so the office knows who to ring — and does
    // not open the profile to find out.
    viaDesignation: g.gifter?.designation ?? null,
    // VENDOR ORDER, OR ONE STUDENT HELPING ANOTHER.
    //
    // Both are gift_orders and looked identical here. They are told apart by
    // whether the person who paid is a registered supporter — a vendor selling
    // for a living, or a sponsor paying for somebody's course.
    source: g.gifter?.is_supporter ? "vendor" : "sponsored",
    discount: g.discount_inr ?? null,
    coupon: g.coupon_code ?? null,
    // WHAT WAS BOUGHT. The office could not tell Gold from Silver on a vendor
    // sale, because these rows have no subscription to look tier up from — the
    // gift order itself is the record.
    tier: g.tier,
    months: g.months,
  }));

  // Plain text match, plus a digits-only pass so a phone/order/invoice typed
  // without its "+91", spaces or dashes still matches what is stored with them.
  const qDigits = q.replace(/\D/g, "");
  const match = (parts: (string | null | undefined)[]) => {
    if (!q) return true;
    return parts.some((p) => {
      const s = (p ?? "").toLowerCase();
      if (s.includes(q)) return true;
      if (qDigits.length >= 4 && s.replace(/\D/g, "").includes(qDigits)) return true;
      return false;
    });
  };
  const orders = ((data ?? []) as unknown as (OrderRow & { invoice_no?: string | null; invoice_url?: string | null })[])
    .filter((o) => matchesState("book_orders", chosen, o.status))
    .filter((o) => match([o.guest_contact?.name, o.guest_contact?.email, o.guest_contact?.phone, o.ship_to?.name, o.ship_to?.phone, o.invoice_no, o.order_no != null ? String(o.order_no) : null, o.tracking_code]));
  const payments = [...payRowsRaw, ...giftRows]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    // Each table in its own words: a supporter sale that went through is
    // "provisioned", so ticking Paid must keep it.
    .filter((p) => matchesState(p.kind === "supporter" ? "gift_orders" : "orders", chosen, p.status))
    .filter((p) => !vendorOnly || (p as { source?: string }).source === "vendor")
    .filter((p) => match([p.profiles?.full_name, p.profiles?.email, p.profiles?.phone, p.invoice_no, p.razorpay_order_id, p.subjects?.title, p.order_no != null ? String(p.order_no) : null, (p as { viaSupporter?: string }).viaSupporter]));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <FilterReset />
      <AdminHero
        badge="💳 Sales & orders"
        title="Sales & orders"
        subtitle="Every payment — subscriptions, extensions and books — with GST invoices, plus book dispatching. 📦"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Search and date range — one form, so a search inside a date range works */}
      <form style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 520 }}>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="🔍 Search order no, name, email, phone, invoice no…" style={{ marginBottom: 0 }} />
          <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
        </div>
        {/* WHAT IS SHOWN, AND WHAT GOES INTO THE DOWNLOAD.
            One set of boxes for both. They used to change only the download,
            so the page could show every order while the spreadsheet held six —
            and there was no way to tell from the screen which was right. */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <span style={{ fontSize: ".78rem", fontWeight: 700 }}>Include:</span>
          {STATUSES.map((st) => (
            <label key={st} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 0, fontSize: ".82rem", textTransform: "capitalize" }}>
              <input type="checkbox" name="status" value={st} defaultChecked={chosen.includes(st)} />
              {st}
            </label>
          ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 0, fontSize: ".82rem", fontWeight: 700 }}>
            <input type="checkbox" name="source" value="vendor" defaultChecked={vendorOnly} />
            💚 Vendor orders only
          </label>
          <span className="muted" style={{ fontSize: ".76rem" }}>
            {chosen.length || vendorOnly ? "Press Search to apply — the list below and the download both follow this." : "Nothing ticked = everything."}
          </span>
          {chosen.length > 0 && <a className="btn small secondary" href="/admin/orders">Show all</a>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
          <div>
            <label style={{ fontSize: ".78rem" }}>From (IST)</label>
            <input type="date" name="from" defaultValue={fromDay} style={{ marginBottom: 0 }} />
          </div>
          <div>
            <label style={{ fontSize: ".78rem" }}>To</label>
            <input type="date" name="to" defaultValue={toDay} style={{ marginBottom: 0 }} />
          </div>
          <SubmitButton className="btn small secondary" savedLabel="✓">Apply dates</SubmitButton>
          {(fromDay || toDay) && <a className="btn small secondary" href="/admin/orders">Clear</a>}
          <span className="muted" style={{ fontSize: ".78rem" }}>
            {fromDay || toDay
              ? `Showing ${fromDay || "the beginning"} → ${toDay || "today"}. The Excel below covers exactly this range.`
              : "Same date in both boxes = that single day."}
          </span>
        </div>
      </form>

      {/* THE ZOHO CONTROLS LIVE ON /admin/accounts NOW — moved 19 Aug on the
          office's instruction: the person who approves sales for Zoho works on
          the Accounts page, so here they were furniture. The per-row ✋ Hold
          stays, because holding something fishy is part of READING the register. */}
      <div className="notice" style={{ marginTop: 18, fontSize: ".85rem" }}>
        🧾 Approving days and pushing sales to Zoho Books is done on the{" "}
        <a href="/admin/accounts" style={{ fontWeight: 700 }}>Accounts &amp; Zoho page</a>, together with the
        invoice and payment exports.
      </div>

      {/* Website payments register — OUR sales only (from our own database).
          Card layout on purpose: every detail visible, NO horizontal scrolling. */}
            {searchParams.confirmed && <div className="notice ok" style={{ marginTop: 12 }}>✅ Payment confirmed — {searchParams.confirmed}.</div>}
      {searchParams.confirmerr && <div className="notice err" style={{ marginTop: 12 }}>❌ {searchParams.confirmerr}</div>}

      <h2 className="admin-section-title" style={{ marginTop: 22 }}>💳 Website payments — subscriptions, extensions &amp; supporter sales ({payments.length})</h2>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
        <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>
          Sales made through this website only — the register you verify Razorpay against.
        </p>
        <span style={{ display: "inline-flex", gap: 8 }}>
          {/* download, not navigate.
              A plain link replaced the whole page with the response, so a slow
              or refused export left the person staring at the browser's own
              "Reload website / Try again" screen where the register had been,
              with no way back except the back button. With `download` the file
              arrives and the page they are reading stays put. */}
          <a className="btn small" download href={`/admin/orders/export${exportQs.toString() ? `?${exportQs}` : ""}`}>
            ⬇️ Download Excel
            {chosen.length ? ` (${chosen.join(", ")})` : fromDay || toDay ? " (filtered range)" : " (everything)"}
          </a>
        </span>
      </div>


      <div style={{ display: "grid", gap: 10 }}>
        {payments.length === 0 && (
          <div className="card"><p className="muted" style={{ margin: 0 }}>{q ? "No payments match your search." : "No payments yet."}</p></div>
        )}
        {payments.map((p) => {
          const pr = p.profiles;
          const dates = pr && p.subject_id ? subDates.get(`${pr.id}:${p.subject_id}`) : undefined;
          const address = pr
            ? [pr.address_line1, pr.address_line2, [pr.city, pr.state, pr.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
            : "";
          return (
            <div className="card" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 10, minWidth: 260, flex: 1 }}>
                  <div>
                    <strong style={{ fontSize: ".98rem" }}>
                      {p.order_no != null ? `#${p.order_no} · ` : ""}{pr?.full_name ?? "—"} · {formatINR(p.amount_inr)}
                    </strong>
                    <p className="muted" style={{ fontSize: ".82rem", margin: "3px 0 0" }}>
                      {p.status === "paid" || p.status === "provisioned" ? "✅ paid" : p.status} · {fmt(p.created_at)} · {p.kind}
                      {` · 🎓 ${levelOfOrder(p) || levelByUser.get(pr?.id ?? "") || "—"}`} · 📘 {p.subjects?.title ?? "—"}
                      {/* WHERE THIS ORDER CAME FROM.
                          A vendor selling for a living and a student paying for
                          somebody else's course are the same table and looked
                          the same here. The badge now says which, and names the
                          vendor. Everything not in that table is a student
                          buying for themselves. */}
                      {(() => {
                        const src = (p as { source?: string }).source;
                        const who = (p as { viaSupporter?: string }).viaSupporter;
                        const job = (p as { viaDesignation?: string | null }).viaDesignation;
                        const named = `${who}${job ? ` (${job})` : ""}`;
                        if (src === "vendor") return <span className="badge" style={{ marginLeft: 6 }}>🏪 Vendor order — {named}</span>;
                        if (src === "sponsored") return <span className="badge" style={{ marginLeft: 6 }}>💚 Student sponsored — {named}</span>;
                        return <span className="badge" style={{ marginLeft: 6 }}>🧑‍🎓 Direct student order</span>;
                      })()}
                      {(p as { coupon?: string | null }).coupon && (
                        <span className="muted" style={{ marginLeft: 6, fontSize: ".8rem" }}>
                          · coupon {(p as { coupon?: string | null }).coupon}
                          {(p as { discount?: number | null }).discount ? ` (−${formatINR((p as { discount?: number | null }).discount!)})` : ""}
                        </span>
                      )}
                    </p>
                    <p className="muted" style={{ fontSize: ".82rem", margin: "3px 0 0" }}>
                      {(() => {
                        // A vendor sale has no subscription row until it is
                        // provisioned, so the plan comes from the gift order
                        // itself — the office could not tell Gold from Silver.
                        const tier = dates?.tier ?? (p as { tier?: string | null }).tier ?? null;
                        const months = dates?.months ?? (p as { months?: number | null }).months ?? null;
                        return <>
                          {tier ? `${TIER_ICON[tier] ?? ""} ${cap(tier)}` : ""}
                          {months ? ` · ${months} month${months === 1 ? "" : "s"}` : ""}
                          {tier || months ? " · " : ""}
                        </>;
                      })()}
                      🗓️ {dates?.starts_at ? fmt(dates.starts_at) : "—"} → {dates?.ends_at ? fmt(dates.ends_at) : "—"}
                      {" · "}✉️ {pr?.email ?? "—"}{pr?.phone ? ` · 📞 ${pr.phone}` : ""}
                    </p>
                    {address && <p className="muted" style={{ fontSize: ".82rem", margin: "3px 0 0" }}>📍 {address}</p>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {p.invoice_url ? (
                    <>
                      <a className="btn small secondary" href={viaProxy(p.invoice_url)} target="_blank" rel="noopener noreferrer">🧾 {p.invoice_no ?? "Invoice"} ↓</a>
                      {/* Put right an invoice raised before the student's
                          address was on file — same number, same date, same
                          amount, correct address and correct tax split, emailed
                          again with an explanation. It refuses if the address
                          is still missing rather than reissue another
                          incomplete document. */}
                      <form action={reissueInvoice} style={{ margin: 0 }}>
                        <input type="hidden" name="orderId" value={p.id} />
                        <SubmitButton className="btn small secondary" savedLabel="✓ Reissued">♻️ Reissue</SubmitButton>
                      </form>
                    </>
                  ) : p.status === "paid" ? (
                    <form action={generateInvoice} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="table" value="orders" />
                      <SubmitButton className="btn small" savedLabel="✓ Generated">🧾 Generate invoice</SubmitButton>
                    </form>
                  ) : p.status === "created" && p.razorpay_order_id ? (
                    /* MONEY AT RAZORPAY, ORDER STUCK HERE. The office types the
                       payment id from the Razorpay dashboard; it must match a
                       CAPTURED payment on this very order or nothing happens.
                       On success the student is enrolled, the invoice takes the
                       NEXT serial in the series (never reused, never backdated)
                       and the emails go — the same path a normal checkout uses.
                       The quarter-hourly sweep does this automatically too;
                       this button is for the student on the phone right now. */
                    <form action={adminConfirmPayment} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="table" value={p.kind === "supporter" ? "gift_orders" : "orders"} />
                      <input name="payment_id" placeholder="pay_…" style={{ marginBottom: 0, width: 150, fontSize: ".8rem" }} />
                      <SubmitButton className="btn small" savedLabel="✓">✅ Confirm payment</SubmitButton>
                    </form>
                  ) : <span className="muted" style={{ fontSize: ".8rem" }}>—</span>}
                  <ZohoCell id={p.id} table="orders" status={p.zoho_status} paid={["paid", "provisioned"].includes(p.status)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
        Invoices are emailed to the payer automatically on payment and stored privately — students never see them
        inside their login. Gift invoices remain on <a href="/admin/reports" className="grad">Reports</a>.
      </p>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>🚚 Book orders ({orders.length})</h2>

      {searchParams.dispatch && (
        <div className={`notice ${searchParams.dispatch === "skipped" ? "err" : "ok"}`} style={{ marginTop: 16 }}>
          {searchParams.dispatch === "skipped"
            ? "Email isn't configured yet (set MAILGUN + WAREHOUSE_EMAIL) — nothing was sent."
            : `📧 Dispatch email sent for ${searchParams.dispatch} order(s).`}
        </div>
      )}

      <form action={sendDispatchEmail} style={{ marginTop: 18 }}>
        <SubmitButton className="btn small">
          📧 Email dispatch list to warehouse
        </SubmitButton>
        <span className="muted" style={{ fontSize: ".8rem", marginLeft: 10 }}>
          Also runs automatically each evening.
        </span>
      </form>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        {orders.length > 0 ? (
          orders.map((o) => {
            const qty = (o.items ?? []).reduce((s, i) => s + (i.qty ?? 0), 0);
            const ship = o.ship_to ?? {};
            return (
              <div className="card" key={o.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 10 }}>
                  <div>
                    <strong>
                      {o.order_no != null ? `#${o.order_no} · ` : ""}{o.guest_contact?.name ?? ship.name ?? "Customer"} · {formatINR(o.amount_inr)}
                    </strong>
                    <p style={{ fontSize: ".84rem", marginTop: 4, fontWeight: 600 }}>
                      📚 {(o.items ?? []).map((i) => {
                        const t = bookTitle.get(String(i.book_id ?? "")) ?? "Book";
                        return (i.qty ?? 1) > 1 ? `${t} × ${i.qty}` : t;
                      }).join(" · ") || "—"}
                    </p>
                    <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                      {qty} item{qty === 1 ? "" : "s"} · {STATUS_EMOJI[o.status] ?? o.status} · {fmt(o.created_at)}
                      {o.tracking_code && <> · 🚚 {o.tracking_code}</>}
                      {o.invoice_url && <> · <a className="grad" href={viaProxy(o.invoice_url)} target="_blank" rel="noopener noreferrer">🧾 {o.invoice_no ?? "Invoice"} ↓</a></>}
                      {o.invoice_url && <> · <span style={{ display: "inline-block" }}><form action={reissueBookInvoice} style={{ margin: 0, display: "inline" }}>
                        <input type="hidden" name="id" value={o.id} />
                        <SubmitButton className="btn small secondary" savedLabel="✓ Reissued">♻️ Reissue with address</SubmitButton>
                      </form></span></>}
                    </p>
                    <p className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>
                      📍 {ship.line1}
                      {ship.line2 ? `, ${ship.line2}` : ""}, {ship.city}, {ship.state} {ship.pincode} ·
                      📞 {ship.phone ?? o.guest_contact?.phone} · ✉️ {o.guest_contact?.email}
                    </p>
                  </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    {!o.invoice_url && o.status !== "cancelled" && (
                      <form action={generateInvoice} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="table" value="book_orders" />
                        <SubmitButton className="btn small" savedLabel="✓ Generated">🧾 Generate invoice</SubmitButton>
                      </form>
                    )}
                    <ZohoCell id={o.id} table="book_orders" status={o.zoho_status ?? null} paid={!["created", "cancelled"].includes(o.status)} />
                    {o.status === "paid" && (
                      <form action={setOrderStatus} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="status" value="dispatched" />
                        <SubmitButton className="btn small">
                          Mark dispatched 🚚
                        </SubmitButton>
                      </form>
                    )}
                    {o.status === "dispatched" && (
                      <form action={setOrderStatus} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="status" value="delivered" />
                        <SubmitButton className="btn small">
                          Mark delivered ✅
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="card">
            <p className="muted">📭 No book orders yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}
