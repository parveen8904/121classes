import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import { planWeek } from "@/lib/marketingWeek";
import { DAY_NAMES } from "@/lib/marketingRhythm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Preview next week's posts — Admin" };

// A sample week, written exactly the way the Monday autopilot writes it, and
// then thrown away. It exists so the founder can read the tone before trusting
// the accounts to it — nothing here is scheduled, emailed or posted.

const istTime = (at: number) =>
  new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function PreviewPage(props: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await props.searchParams;
  const result = run === "1" ? await planWeek() : null;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="👀 Preview"
        title="Next week's posts — a sample"
        subtitle="Reads exactly like the real thing, then disappears. Nothing on this page is scheduled, emailed or posted anywhere. 🧪"
        back={{ href: "/admin/broadcasts", label: "Campaigns" }}
      />

      {!result && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ marginTop: 0 }}>
            This writes a full week — one idea a day, in each platform&apos;s own voice — so you can judge the tone
            before the autopilot uses it on Monday. It takes about a minute, and costs a few rupees of AI.
          </p>
          <Link className="btn" href="/admin/broadcasts/preview?run=1">✍️ Write a sample week</Link>
          <p className="muted" style={{ fontSize: ".78rem", marginBottom: 0 }}>
            Nothing is saved. Refresh the page with the button again for a completely different week.
          </p>
        </div>
      )}

      {result?.error && (
        <div className="notice err" style={{ marginTop: 16 }}>{result.error}</div>
      )}

      {result && !result.error && (
        <>
          <div className="notice ok" style={{ marginTop: 16 }}>
            {result.posts.length} posts written — <strong>none of them scheduled</strong>. This is only a sample of how
            the week would read.
          </div>
          {result.posts.map((p, i) => (
            <div key={i}>
              {(i === 0 || result.posts[i - 1].day !== p.day) && (
                <h3 style={{ margin: "22px 0 2px" }}>
                  {DAY_NAMES[p.day]} <span className="muted" style={{ fontWeight: 400, fontSize: ".85rem" }}>— {p.focus}</span>
                </h3>
              )}
              <div className="card" style={{ marginTop: 8 }}>
                <p className="muted" style={{ fontSize: ".78rem", margin: "0 0 6px" }}>
                  {p.label} · {istTime(p.at)} IST
                </p>
                <div style={{ whiteSpace: "pre-wrap", fontSize: ".92rem" }}>{p.text}</div>
              </div>
            </div>
          ))}
          <p style={{ marginTop: 24 }}>
            <Link className="btn small secondary" href="/admin/broadcasts/preview?run=1">🔄 Write another week</Link>{" "}
            <Link className="btn small secondary" href="/admin/broadcasts">← Back to Campaigns</Link>
          </p>
        </>
      )}
    </section>
  );
}
