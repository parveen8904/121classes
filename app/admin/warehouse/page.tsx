import { formatDateTime } from "@/lib/dates";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { listDispatchQueue } from "@/lib/warehouse";
import { viaProxy } from "@/lib/fileProxy";
import { saveTracking, emailShippingLabels, uploadTracking, bookWithDelhivery, emailMissedDispatches } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warehouse — Admin" };

const fmt = (s: string) =>
  formatDateTime(s);

export default async function WarehousePage(props: {
  searchParams: Promise<{ labels?: string; q?: string; from?: string; to?: string; upload?: string; missed?: string; book?: string; refused?: string; told?: string }>;
}) {
  const searchParams = await props.searchParams;
  const q = (searchParams.q ?? "").trim().toLowerCase();
  // WHICH DAY'S PARCELS. Entered as IST calendar days; the same date in both
  // boxes is exactly that one day. It filters the lists below AND the labels
  // that get emailed, so what is printed is what is on the screen.
  const okDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const fromDay = okDate(searchParams.from);
  const toDay = okDate(searchParams.to);
  const fromMs = fromDay ? new Date(`${fromDay}T00:00:00+05:30`).getTime() : null;
  const toMs = toDay ? new Date(`${toDay}T23:59:59+05:30`).getTime() : null;
  const inRange = (iso: string) => {
    const at = new Date(iso).getTime();
    if (fromMs !== null && at < fromMs) return false;
    if (toMs !== null && at > toMs) return false;
    return true;
  };
  const all = (await listDispatchQueue(false)).filter((i) => inRange(i.createdAt));
  // Shown only when it can actually work — a button that answers "not set up"
  // is a button that teaches people not to press buttons.
  const { delhiveryConfigured } = await import("@/lib/delhivery");
  const delhiveryOn = await delhiveryConfigured();
  const match = (s: (string | null)[]) => !q || s.some((x) => (x ?? "").toLowerCase().includes(q));
  const filtered = all.filter((i) => match([i.orderNo, i.name, i.phone, i.contents, i.tracking]));
  const pending = filtered.filter((i) => !i.tracking);
  const done = filtered.filter((i) => i.tracking).slice(0, 60);
  // Couriers already used, offered first — the warehouse types a name once.
  const couriersUsed = [...new Set(all.map((i) => (i.courier ?? "").trim()).filter(Boolean))].sort();
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

      {searchParams.book && (
        <div className={`notice ${/^\d+$/.test(searchParams.book) && searchParams.book !== "0" ? "ok" : "err"}`} style={{ marginTop: 16 }}>
          {searchParams.book === "unconfigured"
            ? "Delhivery is not set up yet — the API token and pickup-location name are needed first."
            : searchParams.book === "none" ? "No parcels waiting in that range."
            : searchParams.book === "0" ? "Nothing could be booked."
            : `✅ ${searchParams.book} parcel(s) booked with Delhivery — their waybill is now the tracking number.`}
          {searchParams.refused && (
            <div style={{ marginTop: 6, fontSize: ".85rem" }}>
              ⚠️ Delhivery refused: {searchParams.refused}. Those parcels are untouched — book them by hand or fix
              the address and try again.
            </div>
          )}
        </div>
      )}

      {searchParams.upload && (
        <div className={`notice ${/^\d+$/.test(searchParams.upload) && searchParams.upload !== "0" ? "ok" : "err"}`} style={{ marginTop: 16 }}>
          {searchParams.upload === "nofile" ? "Choose a file first — a CSV from the courier with the order numbers and tracking IDs."
            : searchParams.upload === "toobig" ? "That file is too large. Save just the tracking columns as a CSV and try again."
            : searchParams.upload === "empty" ? "That file had no rows we could read. Save it as a plain CSV and try again."
            : searchParams.upload === "0" ? "Nothing matched. The order-number column must hold the numbers shown on this page."
            : `✅ ${searchParams.upload} parcel(s) marked dispatched from the file.`}
          {searchParams.missed && (
            <div style={{ marginTop: 6, fontSize: ".85rem" }}>
              ⚠️ Not matched to a waiting parcel: {searchParams.missed}. They may already be dispatched, or the order
              number may be wrong — nothing was changed for those.
            </div>
          )}
        </div>
      )}

      {searchParams.labels && (
        <div className={`notice ${searchParams.labels === "fail" ? "err" : "ok"}`} style={{ marginTop: 16 }}>
          {searchParams.labels === "fail"
            ? "Couldn't email the labels — check that email (Mailgun) is configured and your account has an email address."
            : searchParams.labels === "empty"
              ? "Nothing to print — every parcel already has a tracking ID."
              : `🏷️ ${searchParams.labels} shipping label(s) emailed to you as a PDF — print and stick them.`}
        </div>
      )}

      {searchParams.told && (
        <div className={`notice ${searchParams.told === "0" ? "" : "ok"}`} style={{ marginTop: 16 }}>
          {searchParams.told === "0"
            ? "Nobody was waiting — every dispatched parcel has already had its tracking number emailed."
            : `📧 ${searchParams.told} student(s) emailed their courier and tracking number.`}
        </div>
      )}

      <div className="card" style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <strong>{pending.length} parcel{pending.length === 1 ? "" : "s"} awaiting dispatch</strong>
          <span className="muted" style={{ fontSize: ".82rem" }}> · {last24h} received in the last 24 hours</span>
        </div>
        {/* THE LABELS FOR ONE DAY, NOT FOR EVERYTHING.
            The whole queue in one PDF is fine on a quiet week and useless on a
            busy one: somebody dispatching Monday's orders does not want
            Tuesday's labels in the same stack, printed and then thrown away.
            The same two dates drive the lists below, so what is printed is
            what is on the screen. Open to the warehouse operator as well as to
            an admin — it is their job, not his. */}
        <form action={emailShippingLabels} style={{ margin: 0, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: ".75rem" }}>From (IST)</label>
            <input type="date" name="from" defaultValue={fromDay} style={{ marginBottom: 0 }} />
          </div>
          <div>
            <label style={{ fontSize: ".75rem" }}>To</label>
            <input type="date" name="to" defaultValue={toDay} style={{ marginBottom: 0 }} />
          </div>
          <SubmitButton className="btn small" savedLabel="✓ Emailed">
            🏷️ Email me the labels{fromDay || toDay ? " for these dates" : ""} (PDF)
          </SubmitButton>
        </form>

        {/* Every invoice for the parcels going out, stapled into one file to
            print and drop in the boxes. Only these parcels — it is not a door
            into the whole invoice book. */}
        <a className="btn small secondary" download
          href={`/admin/warehouse/invoices${fromDay || toDay ? `?${new URLSearchParams({ ...(fromDay ? { from: fromDay } : {}), ...(toDay ? { to: toDay } : {}) })}` : ""}`}>
          🧾 Print invoices for these parcels
        </a>

        {/* One press books every parcel on screen with Delhivery and writes
            their waybill back as the tracking number. Hidden entirely until
            the token is in place, so nobody presses a button that cannot work. */}
        {delhiveryOn && (
          <form action={bookWithDelhivery} style={{ margin: 0 }}>
            <input type="hidden" name="from" value={fromDay} />
            <input type="hidden" name="to" value={toDay} />
            <SubmitButton className="btn small" savedLabel="✓ Booked">
              🚚 Book these with Delhivery
            </SubmitButton>
          </form>
        )}

        {/* THE COURIER'S MANIFEST, UPLOADED.
            They hand back a sheet: one row per parcel, order number and docket.
            Typing forty of those into forty boxes is twenty minutes in which
            one digit goes astray, and that parcel is untraceable until the
            student complains. Any CSV with an order-number column and a
            tracking column is understood; a courier column is used if there is
            one. Rows that match nothing waiting are named back, not skipped. */}
        <form action={uploadTracking} style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="from" value={fromDay} />
          <input type="hidden" name="to" value={toDay} />
          <input type="file" name="file" accept=".csv,text/csv,text/plain,.txt" required
            style={{ marginBottom: 0, fontSize: ".8rem", maxWidth: 230 }} />
          <SubmitButton className="btn small secondary" savedLabel="✓ Uploaded">⬆️ Upload tracking IDs</SubmitButton>
        </form>

        {/* Every dispatch now emails the student the courier and docket number
            automatically. This is only for the ones that missed it — parcels
            sent before that email existed, or a send the mail server refused.
            Pressing it twice is harmless. */}
        <form action={emailMissedDispatches} style={{ margin: 0 }}>
          <SubmitButton className="btn small secondary" savedLabel="✓ Sent">
            📧 Email students who were never sent their tracking
          </SubmitButton>
        </form>
      </div>

      {/* Suggested, not enforced — a warehouse uses whoever is cheapest that
          week, and a fixed list would send somebody hunting for "Other". */}
      <datalist id="couriers">
        {couriersUsed.map((c) => <option key={c} value={c} />)}
        {["Delhivery", "DTDC", "Blue Dart", "India Post", "Trackon", "Professional Couriers", "Ekart", "Xpressbees"]
          .filter((c) => !couriersUsed.includes(c))
          .map((c) => <option key={c} value={c} />)}
      </datalist>

      <form style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="🔍 Search order no, name, phone, tracking…" style={{ marginBottom: 0 }} />
          <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
          <div>
            <label style={{ fontSize: ".75rem" }}>Show parcels from (IST)</label>
            <input type="date" name="from" defaultValue={fromDay} style={{ marginBottom: 0 }} />
          </div>
          <div>
            <label style={{ fontSize: ".75rem" }}>To</label>
            <input type="date" name="to" defaultValue={toDay} style={{ marginBottom: 0 }} />
          </div>
          <SubmitButton className="btn small secondary" savedLabel="✓">Apply dates</SubmitButton>
          {(fromDay || toDay) && <a className="btn small secondary" href="/admin/warehouse">Clear dates</a>}
          <span className="muted" style={{ fontSize: ".78rem" }}>
            {fromDay || toDay
              ? `Showing ${fromDay || "the beginning"} → ${toDay || "today"}. The labels above cover exactly this.`
              : "Same date in both boxes = that single day."}
          </span>
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
                {/* The tax invoice goes in the box. It used to live only under
                    Sales & orders, so a packer had to ask an admin for every
                    single parcel. */}
                <p style={{ margin: "6px 0 0" }}>
                  {i.invoiceUrl ? (
                    <a className="btn small secondary" href={viaProxy(i.invoiceUrl)} target="_blank" rel="noopener noreferrer">
                      🧾 Invoice{i.invoiceNo ? ` ${i.invoiceNo}` : ""}
                    </a>
                  ) : (
                    <span className="muted" style={{ fontSize: ".78rem" }}>no invoice raised yet</span>
                  )}
                </p>
              </div>
              {/* Courier name AND tracking ID. A tracking number on its own
                  is not traceable — DEL122019183 means nothing until you know
                  whether to type it into Delhivery, DTDC or Blue Dart, and the
                  only person who knew was whoever handed the parcel over. */}
              <form action={saveTracking} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, flexWrap: "wrap" }}>
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="table" value={i.table} />
                <input name="courier" list="couriers" placeholder="Courier name" style={{ marginBottom: 0, minWidth: 140 }} />
                <input name="tracking" placeholder="Courier tracking ID" required style={{ marginBottom: 0, minWidth: 180 }} />
                <SubmitButton className="btn small" savedLabel="✓ Saved">🚚 Save</SubmitButton>
              </form>
              {delhiveryOn && (
                <form action={bookWithDelhivery} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={i.id} />
                  <SubmitButton className="btn small secondary" savedLabel="✓ Booked">Book this one</SubmitButton>
                </form>
              )}
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
              <p className="row-sub">{i.contents} · 🚚 {i.courier ? `${i.courier} · ` : ""}{i.tracking} · {fmt(i.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
