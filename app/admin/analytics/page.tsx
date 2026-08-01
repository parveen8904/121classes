import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { loadAnalytics, type Range } from "@/lib/analytics";
import { BarChart, Delta, Stat } from "./Chart";

// Visitors and usage over time, from our own page_views and watch records.
// Every headline number is shown next to the same number for the period
// before it — a count with nothing to compare it to tells you nothing.

export const dynamic = "force-dynamic";

const RANGES: { days: Range; label: string }[] = [
  { days: 7, label: "Week" },
  { days: 30, label: "Month" },
  { days: 90, label: "3 months" },
];

export default async function AdminAnalyticsPage(props: { searchParams: Promise<{ days?: string }> }) {
  const searchParams = await props.searchParams;
  const days = ([7, 30, 90] as const).includes(Number(searchParams.days) as Range)
    ? (Number(searchParams.days) as Range)
    : 30;
  const a = await loadAnalytics(days);
  const period = days === 7 ? "week" : days === 30 ? "month" : "3 months";

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📈 Analytics"
        title="Visitors & usage"
        subtitle="Who came to the site, how much they used it, and whether that is more or less than the period before. Counted from our own records — no outside tracker is involved."
        back={{ href: "/admin", label: "Admin" }}
      />

      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        {RANGES.map((r) => (
          <Link
            key={r.days}
            href={`/admin/analytics?days=${r.days}`}
            className={days === r.days ? "btn small" : "btn small secondary"}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        <Stat label={`Visitors this ${period}`} value={a.visitors.now} sub="different people">
          <Delta now={a.visitors.now} before={a.visitors.before} />
        </Stat>
        <Stat label="Pages opened" value={a.views.now}>
          <Delta now={a.views.now} before={a.views.before} />
        </Stat>
        <Stat label="Signed-in students active" value={a.activeStudents.now} sub="logged in and used the site">
          <Delta now={a.activeStudents.now} before={a.activeStudents.before} />
        </Stat>
        <Stat label="New signups" value={a.signups.now}>
          <Delta now={a.signups.now} before={a.signups.before} />
        </Stat>
        <Stat label="Logins" value={a.logins.now}>
          <Delta now={a.logins.now} before={a.logins.before} />
        </Stat>
        <Stat label="Class hours watched" value={a.watchHours.now} sub="the load behind the video bill">
          <Delta now={a.watchHours.now} before={a.watchHours.before} unit="h" />
        </Stat>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>👥 Visitors, day by day</h2>
      <div className="card">
        <BarChart points={a.visitors.series} />
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 8, marginBottom: 0 }}>
          {a.busiestDay
            ? `Busiest day: ${a.busiestDay.label} with ${a.busiestDay.value.toLocaleString("en-IN")} visitors.`
            : "No visitors recorded in this period."}
          {a.peakHourIST &&
            ` Most traffic arrives around ${a.peakHourIST.hour}:00–${(a.peakHourIST.hour + 1) % 24}:00 IST.`}
        </p>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>🎓 Students actually using the site</h2>
      <div className="card">
        <BarChart points={a.activeStudents.series} colour="#16a34a" />
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>🎥 Class hours watched</h2>
      <div className="card">
        <BarChart points={a.watchHours.series} colour="#7c3aed" suffix=" h" />
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 8, marginBottom: 0 }}>
          Watch time is the honest measure of load: video is what the site actually spends bandwidth on, and this rises
          and falls with it.
        </p>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>📄 Most-opened pages</h2>
      <div className="card">
        {a.topPages.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing recorded yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {a.topPages.map((p) => {
              const share = Math.round((p.views / Math.max(1, a.topPages[0].views)) * 100);
              return (
                <div key={p.path} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ flex: "0 0 46%", fontSize: ".85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.path}
                  </div>
                  <div style={{ flex: 1, background: "var(--bg-soft)", borderRadius: 6, height: 12 }}>
                    <div style={{ width: `${share}%`, background: "var(--accent)", height: "100%", borderRadius: 6 }} />
                  </div>
                  <div className="muted" style={{ fontSize: ".8rem", width: 60, textAlign: "right" }}>
                    {p.views.toLocaleString("en-IN")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
