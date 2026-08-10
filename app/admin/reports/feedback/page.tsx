import { formatDateTime } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { FEEDBACK_RATINGS, ALL_RATING_KEYS } from "@/lib/feedbackQuestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback — Admin" };

// WHAT STUDENTS SAID, AND WHERE IT HURTS.
//
// The averages are the least interesting part and sit at the top only because
// they say WHICH question to look at. What matters is underneath: the ones who
// scored us badly, in their own words, with a way to reach them.
//
// So the complaints are shown first and in full. A report that opens with "4.2
// out of 5" and buries the person who said the paper checking was unfair is a
// report that makes everybody feel better and changes nothing.

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  what_went_wrong: string | null;
  how_to_improve: string | null;
  source: string | null;
  created_at: string;
} & Record<string, number | null | string>;

const IST = (s: string) =>
  formatDateTime(s);

const colour = (avg: number) => (avg >= 4 ? "#16a34a" : avg >= 3 ? "#b45309" : "#b91c1c");

export default async function FeedbackReport(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  await assertArea("inbox");
  const { days } = await props.searchParams;
  const windowDays = Math.min(365, Math.max(7, Number(days) || 90));

  const svc = createServiceClient();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const { data } = await svc
    .from("student_feedback")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows = (data ?? []) as Row[];

  const stats = FEEDBACK_RATINGS.map((q) => {
    const vals = rows.map((r) => r[q.key]).filter((v): v is number => typeof v === "number");
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const poor = vals.filter((v) => v <= 2).length;
    return { ...q, avg, answered: vals.length, poor };
  }).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9));

  // Anybody who scored something 1 or 2, or who wrote a complaint.
  const unhappy = rows.filter(
    (r) => ALL_RATING_KEYS.some((k) => typeof r[k] === "number" && (r[k] as number) <= 2) || r.what_went_wrong,
  );
  const suggestions = rows.filter((r) => r.how_to_improve && !unhappy.includes(r));

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📝 Feedback"
        title="What students say about us"
        subtitle="The complaints first, in their own words, with a way to reach them. Averages underneath — they tell you which question to look at, nothing more."
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="card" style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "baseline" }}>
        <div><strong style={{ fontSize: "1.5rem" }}>{rows.length}</strong><div className="muted">replies in {windowDays} days</div></div>
        <div>
          <strong style={{ fontSize: "1.5rem", color: unhappy.length ? "#b91c1c" : "#16a34a" }}>{unhappy.length}</strong>
          <div className="muted">unhappy — read these</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {[30, 90, 365].map((d) => (
            <a key={d} className={`btn small ${windowDays === d ? "" : "secondary"}`} href={`/admin/reports/feedback?days=${d}`}>
              {d === 365 ? "1 year" : `${d} days`}
            </a>
          ))}
        </div>
      </div>

      {rows.length === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>
          Nothing yet. The form is linked in the site footer and offered at the end of a doubt.
        </p>
      )}

      {/* ── The people who are not happy ───────────────────────────────── */}
      {unhappy.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 24 }}>😟 Not happy ({unhappy.length})</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {unhappy.map((r) => {
              const bad = FEEDBACK_RATINGS.filter((q) => typeof r[q.key] === "number" && (r[q.key] as number) <= 2);
              return (
                <div className="card" key={r.id} style={{ borderLeft: "4px solid #b91c1c" }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                    <strong>{r.name}</strong>
                    {r.email && <span className="muted" style={{ fontSize: ".82rem" }}>{r.email}</span>}
                    {r.phone && <a href={`tel:${r.phone}`} className="badge">📞 {r.phone}</a>}
                    <span className="muted" style={{ marginLeft: "auto", fontSize: ".8rem" }}>{IST(r.created_at)}</span>
                  </div>
                  {bad.length > 0 && (
                    <p className="muted" style={{ margin: "6px 0 0", fontSize: ".82rem" }}>
                      Rated poorly: {bad.map((q) => q.label.replace(/\?$/, "")).join(" · ")}
                    </p>
                  )}
                  {r.what_went_wrong && (
                    <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                      <strong>What went wrong.</strong> {r.what_went_wrong}
                    </p>
                  )}
                  {r.how_to_improve && (
                    <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                      <strong>What to improve.</strong> {r.how_to_improve}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Averages: which question to look at ────────────────────────── */}
      {rows.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 24 }}>Where we stand — worst first</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}>Question</th>
                  <th style={{ padding: "4px 8px" }}>Average</th>
                  <th style={{ padding: "4px 8px" }}>Answered</th>
                  <th style={{ padding: "4px 8px" }}>Rated 1–2</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((q) => (
                  <tr key={q.key} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "4px 8px" }}>{q.label}</td>
                    <td style={{ padding: "4px 8px", fontWeight: 700, color: q.avg ? colour(q.avg) : undefined }}>
                      {q.avg ? q.avg.toFixed(1) : "—"}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{q.answered}</td>
                    <td style={{ padding: "4px 8px", color: q.poor ? "#b91c1c" : undefined }}>{q.poor || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Suggestions from people who were otherwise content ─────────── */}
      {suggestions.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 24 }}>💡 Suggestions ({suggestions.length})</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {suggestions.map((r) => (
              <div className="card" key={r.id}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <strong style={{ fontSize: ".9rem" }}>{r.name}</strong>
                  <span className="muted" style={{ marginLeft: "auto", fontSize: ".78rem" }}>{IST(r.created_at)}</span>
                </div>
                <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", fontSize: ".9rem" }}>{r.how_to_improve}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
