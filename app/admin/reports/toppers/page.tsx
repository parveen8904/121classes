import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { inChunks } from "@/lib/pageAll";
import AdminHero from "../../_components/AdminHero";
import { rank, topBy, WEIGHTS, ACTIVITIES, type Effort, type Scored } from "@/lib/studentRanking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top students — Admin" };

// WHO TO GROOM.
//
// Not "who paid the most" and not "who logged in today" — who is actually
// working through the course. Ranked separately for CA Final and CA Inter,
// because they are different races, and shown with the plain numbers beside the
// score so the founder can disagree with the ranking at a glance rather than
// taking it on trust.
//
// The counting is a database view (public.student_effort); the weights are in
// lib/studentRanking.ts.

const SHOW = 25;
// He asked for fifty in each plain list, across all time.
const TOP_N = 50;

export default async function ToppersPage(props: {
  searchParams: Promise<{ all?: string }>;
}) {
  if (!(await requireArea("store")) && !(await requireArea("results"))) redirect("/admin");
  const sp = await props.searchParams;
  const showAll = sp.all === "1";
  const svc = createServiceClient();

  const [{ data: effortRows }, { data: courseRows }] = await Promise.all([
    svc.from("student_effort").select("*").limit(5000),
    svc.from("courses").select("id, title"),
  ]);

  const effort = (effortRows ?? []) as unknown as Effort[];
  const courses = new Map((courseRows ?? []).map((c) => [String(c.id), String(c.title)]));

  // Nobody who has done nothing at all. A leaderboard of two thousand zeroes
  // buries the thirty-nine people it exists to find.
  const doing = effort.filter(
    (e) => e.classes_done + e.revisions_done + e.tests_done + e.mcq_done + e.cases_done > 0,
  );

  const ids = [...new Set(doing.map((e) => e.student_id))];
  const people = new Map<string, { name: string; email: string; phone: string; attempt: string }>();
  if (ids.length) {
    const rows = await inChunks<{ id: string; full_name: string | null; email: string | null; phone: string | null; target_attempt: string | null }>(
      ids, (b) => svc.from("profiles").select("id, full_name, email, phone, target_attempt").in("id", b) as never,
    );
    for (const r of rows) {
      people.set(r.id, {
        name: r.full_name ?? "—", email: r.email ?? "", phone: r.phone ?? "",
        attempt: r.target_attempt ?? "",
      });
    }
  }

  const byCourse = new Map<string, Scored[]>();
  for (const [courseId] of courses) {
    const rows = doing.filter((e) => e.course_id === courseId);
    if (rows.length) byCourse.set(courseId, rank(rows));
  }

  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1040 }}>
      <AdminHero
        badge="🏅 Top students"
        title="Who is actually working"
        subtitle="Ranked on what the site can see — classes, revisions, tests and practice — so the students worth mentoring are visible without guessing. 🎯"
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <div className="card" style={{ marginTop: 16, fontSize: ".86rem", lineHeight: 1.7 }}>
        <strong>How the score is worked out.</strong> Out of 100, against everything available in that course —
        not against the other students, so a rank never moves because somebody else studied.
        <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li><strong>{WEIGHTS.classes}</strong> — classes finished (not merely opened)</li>
          <li><strong>{WEIGHTS.revisions}</strong> — revision classes finished</li>
          <li><strong>{WEIGHTS.tests}</strong> — mock &amp; descriptive papers, <em>attempted × how well they scored</em></li>
          <li><strong>{WEIGHTS.practice}</strong> — case scenarios &amp; MCQ tests, the same way</li>
        </ul>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: ".82rem" }}>
          A paper submitted but not yet marked counts as full credit — the marking queue is ours, and nobody should
          slip down this list because we have not got to their copy. Anyone who has done nothing at all is left out.
        </p>
      </div>

      {/* THE PLAIN LISTS.
          A weighted score answers "who should I mentor". It does not answer
          "who has watched the most classes" — and a student who has sat every
          case study and no classes is invisible in the first and top of the
          fourth. Same numbers, no arithmetic in between, nothing to argue with. */}
      <h2 className="admin-section-title" style={{ marginTop: 30 }}>📋 Top {TOP_N} for each thing, on its own</h2>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: -4 }}>
        All time, both courses together, counted straight. Anybody on nought is left out — a list of fifty where
        forty are zero is a list of everybody.
      </p>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", marginTop: 12 }}>
        {ACTIVITIES.map((a) => {
          const list = topBy(doing, a.key, TOP_N);
          return (
            <div className="card" key={a.key} style={{ padding: "12px 14px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>
                {a.icon} {a.label} <span className="muted" style={{ fontWeight: 400, fontSize: ".82rem" }}>({list.length})</span>
              </h3>
              {list.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: ".84rem" }}>
                  Nobody has done one of these yet.
                </p>
              ) : (
                <ol style={{ margin: 0, paddingLeft: 22, fontSize: ".86rem", lineHeight: 1.9 }}>
                  {list.map((r) => {
                    const p = people.get(r.student_id);
                    return (
                      <li key={`${a.key}:${r.student_id}:${r.course_id}`}>
                        <Link href={`/admin/users/${r.student_id}`}>{p?.name || "—"}</Link>
                        {" — "}<strong>{Number(r[a.key])}</strong>
                        <span className="muted" style={{ fontSize: ".78rem" }}>
                          {" "}· {(courses.get(r.course_id) ?? "").replace("CA ", "")}
                          {p?.phone ? ` · ${p.phone}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 34 }}>🏅 The weighted ranking</h2>

      {byCourse.size === 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <p className="muted" style={{ margin: 0 }}>Nobody has finished a class, a test or a case study yet.</p>
        </div>
      )}

      {[...byCourse.entries()].map(([courseId, scored]) => {
        const shown = showAll ? scored : scored.slice(0, SHOW);
        return (
          <div key={courseId} style={{ marginTop: 26 }}>
            <h2 className="admin-section-title">
              🎓 {courses.get(courseId) ?? "Course"} — {scored.length} student{scored.length === 1 ? "" : "s"} working
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 860, width: "100%", borderCollapse: "collapse", fontSize: ".86rem" }}>
                <thead>
                  <tr>
                    {["#", "Student", "Score", `Classes (${WEIGHTS.classes})`, `Revision (${WEIGHTS.revisions})`,
                      `Tests (${WEIGHTS.tests})`, `Practice (${WEIGHTS.practice})`, "Contact"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s, i) => {
                    const p = people.get(s.student_id);
                    const cell = { padding: "8px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" } as const;
                    return (
                      <tr key={s.student_id}>
                        <td style={cell}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>
                        <td style={cell}>
                          <Link href={`/admin/users/${s.student_id}`}>{p?.name || "—"}</Link>
                          {p?.attempt ? <span className="muted" style={{ display: "block", fontSize: ".78rem" }}>🎯 {p.attempt}</span> : null}
                        </td>
                        <td style={{ ...cell, fontWeight: 800, fontSize: "1rem" }}>{s.total}</td>
                        <td style={cell}>
                          {s.shown.classes}
                          <span className="muted" style={{ display: "block", fontSize: ".76rem" }}>{s.parts.classes} pts</span>
                        </td>
                        <td style={cell}>
                          {s.shown.revisions}
                          <span className="muted" style={{ display: "block", fontSize: ".76rem" }}>{s.parts.revisions} pts</span>
                        </td>
                        <td style={cell}>
                          {s.shown.tests}
                          <span className="muted" style={{ display: "block", fontSize: ".76rem" }}>
                            {s.parts.tests} pts · scored {pct(s.shown.testAccuracy)}
                          </span>
                        </td>
                        <td style={cell}>
                          {s.shown.practice}
                          <span className="muted" style={{ display: "block", fontSize: ".76rem" }}>
                            {s.parts.practice} pts · scored {pct(s.shown.practiceAccuracy)}
                          </span>
                        </td>
                        <td style={{ ...cell, fontSize: ".8rem", wordBreak: "break-all" }}>
                          {p?.phone ? <>📞 {p.phone}<br /></> : null}
                          {p?.email ? <span className="muted">{p.email}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!showAll && scored.length > SHOW && (
              <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
                Showing the top {SHOW} of {scored.length}. <Link href="/admin/reports/toppers?all=1">See everyone →</Link>
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
