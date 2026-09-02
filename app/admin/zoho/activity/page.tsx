import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { zohoConfigured } from "@/lib/zohoApi";
import { recentZohoActivity } from "@/lib/zohoActivity";
import Money from "@/app/components/Money";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// WHAT HAS CHANGED IN THE BOOKS.
//
// On its own page, not on the desk: it asks Zoho seven questions and he should
// not pay for that every time he opens the bills list. He comes here when he
// wants to know what has been going on in the books — including the half this
// system did not do.

export default async function ZohoActivityPage() {
  await assertArea("zoho");
  const connected = await zohoConfigured();
  const { rows, unread } = connected ? await recentZohoActivity(50) : { rows: [], unread: [] };

  const when = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      hour12: true, timeZone: "Asia/Kolkata",
    }).format(d);
  };
  // Rupees get the ledger cell; a foreign-currency figure keeps its own code in
  // front of it, because USD 20.00 under ₹1,745.00 would only pretend to line up.
  const money = (n: number | null, c: string) =>
    c === "INR" || n === null
      ? <Money n={n} width={118} />
      : <span style={{ display: "inline-flex", width: 118, justifyContent: "space-between", gap: 6, fontVariantNumeric: "tabular-nums" }}>
          <span>{c}</span><span>{n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </span>;

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 980 }}>
      <AdminHero
        badge="📜 Zoho activity"
        title="What has changed in the books"
        subtitle="The last 50 changes in Zoho, newest first — raised or altered, by this desk or by anyone working in Zoho directly. Reading only; nothing here can change anything."
        back={{ href: "/admin/zoho", label: "The books desk" }}
      />

      {!connected ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Zoho is not connected yet.</p></div>
      ) : rows.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Zoho reported nothing — which usually means the connection needs re-authorising.</p></div>
      ) : (
        <>
          {unread.length > 0 && (
            <div className="card" style={{ borderLeft: "4px solid #b45309", marginBottom: 10 }}>
              <strong style={{ fontSize: ".85rem" }}>⚠ Not everything could be read</strong>
              <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
                {unread.join(" · ")} — so changes there are missing from this list rather than absent from the books.
              </p>
            </div>
          )}
          <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
            <strong>Raised</strong> means the entry was created then; <strong>altered</strong> means an entry that
            already existed was changed. <strong>This desk</strong> marks the ones posted from the portal on your
            approval — anything else was done inside Zoho.
          </p>
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>When</th>
                  <th style={{ padding: "10px 12px" }}>What</th>
                  <th style={{ padding: "10px 12px" }}>Document</th>
                  <th style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}>Amount</th>
                  <th style={{ padding: "10px 12px" }}>Raised by</th>
                  <th style={{ padding: "10px 12px" }}>Where from</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.when}-${i}`} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{when(r.when)}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {r.kind}
                      <span className="muted" style={{ fontSize: ".78rem" }}> · {r.created ? "raised" : "altered"}</span>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {r.label}
                      {r.status ? <span className="muted" style={{ fontSize: ".78rem" }}> · {r.status}</span> : null}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {money(r.amount, r.currency)}
                    </td>
                    <td style={{ padding: "9px 12px" }}>{r.by ?? "—"}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {r.ours
                        ? <span style={{ color: "#0e6e52" }}>this desk</span>
                        : <span className="muted">in Zoho</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 10 }}>
            Zoho records who <em>raised</em> an entry, not who last edited it — so &ldquo;altered&rdquo; rows name the
            person who first created the document. <Link href="/admin/zoho/invoices">← back to the bills</Link>
          </p>
        </>
      )}
    </section>
  );
}
