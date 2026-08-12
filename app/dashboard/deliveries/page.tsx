import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deliveriesFor } from "@/lib/deliveries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your books — CA Parveen Sharma" };

// WHERE ARE MY BOOKS.
//
// The warehouse has been entering the courier name and tracking number all
// along; there was simply no page on which a student could read them. This is
// that page. It shows the docket number, the courier's proper name, and a link
// that lands on the courier's own tracking site with the number already in it.
//
// When the courier is one we do not have a link for, the number is still
// printed plainly for copying. A number the student can read out on the phone
// is worth a great deal more than a blank space.

const dmy = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function DeliveriesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/deliveries");

  const parcels = await deliveriesFor(user.id, user.email ?? null);
  const onTheWay = parcels.filter((p) => p.tracking);
  const packing = parcels.filter((p) => !p.tracking);

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 780 }}>
      <p style={{ marginBottom: 6 }}>
        <Link className="muted" href="/dashboard">← Dashboard</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Your books</h1>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
        Every parcel we have sent you, with its courier and docket number. Books normally leave us within 24 hours
        of the order and reach most addresses in 3–4 days.
      </p>

      {!parcels.length && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>
            Nothing to show yet — no printed books on your account. They appear here the moment an order is placed.
          </p>
          <p style={{ marginBottom: 0, marginTop: 10 }}>
            <Link className="btn small" href="/books">See the books</Link>
          </p>
        </div>
      )}

      {onTheWay.map((p) => (
        <div className="card" key={p.id} style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong style={{ fontSize: "1.02rem" }}>{p.what}</strong>
            <span className="muted" style={{ fontSize: ".82rem" }}>Order {p.orderNo} · placed {dmy(p.placedAt)}</span>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 22, flexWrap: "wrap" }}>
            <div>
              <div className="muted" style={{ fontSize: ".74rem", textTransform: "uppercase", letterSpacing: ".04em" }}>Courier</div>
              <div style={{ fontWeight: 600 }}>{p.courier || "—"}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: ".74rem", textTransform: "uppercase", letterSpacing: ".04em" }}>Tracking number</div>
              {/* Selectable and monospaced — this gets copied, and read down a phone. */}
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "1.02rem", userSelect: "all" }}>
                {p.tracking}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {p.trackUrl ? (
              <a className="btn small" href={p.trackUrl} target="_blank" rel="noopener noreferrer">
                Track this parcel →
              </a>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: ".84rem", lineHeight: 1.7 }}>
                Search this number on the {p.courier || "courier"} website to see where it is. If you cannot find it,
                write to <a href="mailto:contact@caparveensharma.com">contact@caparveensharma.com</a> with the order
                number above and we will chase it for you.
              </p>
            )}
          </div>
        </div>
      ))}

      {packing.map((p) => (
        <div className="card" key={p.id} style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong style={{ fontSize: "1.02rem" }}>{p.what}</strong>
            <span className="muted" style={{ fontSize: ".82rem" }}>Order {p.orderNo} · placed {dmy(p.placedAt)}</span>
          </div>
          <p className="muted" style={{ marginBottom: 0, marginTop: 8, lineHeight: 1.7 }}>
            Being packed. The courier name and tracking number appear here — and arrive by email — as soon as it is
            handed over.
          </p>
        </div>
      ))}
    </section>
  );
}
