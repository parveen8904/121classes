import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { listDispatchQueue } from "@/lib/warehouse";
import { saveTracking, emailShippingLabels } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warehouse — Admin" };

const fmt = (s: string) =>
  new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function WarehousePage(props: { searchParams: Promise<{ labels?: string; q?: string }> }) {
  const searchParams = await props.searchParams;
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const all = await listDispatchQueue(false);
  const match = (s: (string | null)[]) => !q || s.some((x) => (x ?? "").toLowerCase().includes(q));
  const filtered = all.filter((i) => match([i.orderNo, i.name, i.phone, i.contents, i.tracking]));
  const pending = filtered.filter((i) => !i.tracking);
  const done = filtered.filter((i) => i.tracking).slice(0, 60);
  const last24h = pending.filter((i) => Date.now() - new Date(i.createdAt).getTime() < 24 * 3600 * 1000).length;
  // The search travels with the download, so the file is what is on the screen.
  const qs = q ? `&q=${encodeURIComponent(searchParams.q ?? "")}` : "";

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="🏭 Warehouse"
        title="Warehouse & shipping"
        subtitle="Every parcel to courier — book orders and FREE Gold book sets. Print labels, ship, enter the tracking ID. 🚚"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.labels && (
        <div className={`notice ${searchParams.labels === "fail" ? "err" : "ok"}`} style={{ marginTop: 16 }}>
          {searchParams.labels === "fail"
            ? "Couldn't email the labels — check that email (Mailgun) is configured and your account has an email address."
            : searchParams.labels === "empty"
              ? "Nothing to print — every parcel already has a tracking ID."
              : `🏷️ ${searchParams.labels} shipping label(s) emailed to you as a PDF — print and stick them.`}
        </div>
      )}

      <div className="card" style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <strong>{pending.length} parcel{pending.length === 1 ? "" : "s"} awaiting dispatch</strong>
          <span className="muted" style={{ fontSize: ".82rem" }}> · {last24h} received in the last 24 hours</span>
        </div>
        <form action={emailShippingLabels} style={{ margin: 0 }}>
          <SubmitButton className="btn small" savedLabel="✓ Emailed">🏷️ Email me the shipping labels (PDF)</SubmitButton>
        </form>
      </div>

      <form style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="🔍 Search order no, name, phone, tracking…" style={{ marginBottom: 0 }} />
          <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
        </div>
      </form>

      {/* THE SAME LIST, AS A SPREADSHEET.
          The screen is for working through parcels one at a time. The file is
          for the rest of the job — handing a courier the day's consignments,
          checking last month against an invoice, keeping a record that outlives
          the queue. Both downloads carry whatever is in the search box above,
          so the file always matches what is on the screen. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "20px 0 8px" }}>
        <h3 style={{ margin: 0 }}>📦 To dispatch ({pending.length})</h3>
        <a className="btn small secondary" download href={`/admin/warehouse/export?which=pending${qs}`}>
          ⬇️ Download Excel{q ? " (search)" : ""}
        </a>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {pending.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing waiting — all parcels are on their way. 🎉</p></div>}
        {pending.map((i) => (
          <div className="card" key={`${i.table}:${i.id}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 240, flex: 1 }}>
                <strong>{i.orderNo} · {i.name}</strong>
                <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 0" }}>{i.contents}</p>
                <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 0" }}>
                  📍 {i.address || "no address on file — call the student"} · 📞 {i.phone || "—"} · 🕐 {fmt(i.createdAt)}
                </p>
              </div>
              <form action={saveTracking} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="table" value={i.table} />
                <input name="tracking" placeholder="Courier tracking ID" required style={{ marginBottom: 0, minWidth: 180 }} />
                <SubmitButton className="btn small" savedLabel="✓ Saved">🚚 Save tracking</SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "24px 0 8px" }}>
        <h3 style={{ margin: 0 }}>✅ Dispatched ({done.length})</h3>
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          {/* The screen shows the last sixty so the page stays readable; the
              file holds every one of them, which is the point of a record. */}
          <a className="btn small secondary" download href={`/admin/warehouse/export?which=dispatched${qs}`}>
            ⬇️ Download Excel
          </a>
          <a className="btn small secondary" download href={`/admin/warehouse/export?which=all${qs}`}>
            ⬇️ Everything
          </a>
        </span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {done.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing dispatched yet.</p></div>}
        {done.map((i) => (
          <div className="list-row" key={`${i.table}:${i.id}`}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title">{i.orderNo} · {i.name}</span>
              <p className="row-sub">{i.contents} · 🚚 {i.tracking} · {fmt(i.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
