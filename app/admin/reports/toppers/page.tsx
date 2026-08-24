import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { inChunks, selectAll } from "@/lib/pageAll";
import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { previewToppers, sendToppersNow } from "./actions";
import { istDay } from "@/lib/dailyToppers";
import { BOARDS, boardRows, rank, WEIGHTS, type Effort } from "@/lib/studentRanking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboards — Admin" };

// THE MENTORING REPORT.
//
// One board per question, each with its leader named at the top — because "who
// is doing best" has a different answer depending on what you mean, and the
// founder is going to ring these people. Filterable by exam attempt, since a
// student sitting in May 2027 is not racing somebody sitting in November.
//
// Phone and email on every row. A leaderboard you cannot act on is a poster.
//
// The counting is the database view public.student_effort; what each board
// ranks by is in lib/studentRanking.ts.

const PER_BOARD = 50;

export default async function ToppersPage(props: {
  searchParams: Promise<{ attempt?: string; course?: string; day?: string; preview?: string; sent?: string }>;
}) {
  if (!(await requireArea("store")) && !(await requireArea("results")) && !(await requireArea("reports"))) redirect("/admin");
  const sp = await props.searchParams;
  const svc = createServiceClient();

  // .limit(5000) DID NOT MEAN 5000.
  //
  // PostgREST caps a response at a thousand rows however large a limit is
  // asked for, and there are two thousand and seventy-two here — one row per
  // student per course. So half the school was dropped before any board was
  // drawn, and the half that went was decided by nothing but the order the
  // view happened to return: 483 CA Final rows and 589 CA Intermediate ones,
  // silently, with no error and no gap on the screen to suggest it.
  //
  // Thirteen of the twenty-four CA Final students who have actually done
  // something were in the part that never arrived — which is why that board
  // looked empty when it was not.
  //
  // selectAll pages until the rows run out, which is what the limit was
  // always meant to say.
  const [effortRows, { data: courseRows }] = await Promise.all([
    // student_effort is an UNORDERED view. Paginating an unordered result with
    // .range() lets Postgres return the same row on two pages and drop others —
    // which is why Krishi Bhatia appeared at both rank 1 and rank 2 with
    // identical figures while somebody else vanished. A stable, unique sort
    // (one row per student+course) makes every page deterministic.
    selectAll<Effort>((from, to) => svc.from("student_effort").select("*").order("student_id", { ascending: true }).order("course_id", { ascending: true }).range(from, to) as never),
    svc.from("courses").select("id, title"),
  ]);

  const effort = (effortRows ?? []) as unknown as Effort[];
  const courses = new Map((courseRows ?? []).map((c) => [String(c.id), String(c.title)]));

  // Anybody who has done something at all. A board of zeroes is a list of
  // everybody, and buries the handful it exists to find.
  const doing = effort.filter(
    (e) => e.classes_done + e.classes_ticked + e.revisions_done + e.revisions_ticked +
           e.tests_done + e.mcq_done + e.cases_done > 0,
  );

  type Person = { name: string; email: string; phone: string; attempt: string };
  const people = new Map<string, Person>();
  const staff = new Set<string>();
  const ids = [...new Set(doing.map((e) => e.student_id))];
  if (ids.length) {
    const rows = await inChunks<{ id: string; full_name: string | null; email: string | null; phone: string | null; target_attempt: string | null; role: string | null }>(
      ids, (b) => svc.from("profiles").select("id, full_name, email, phone, target_attempt, role").in("id", b) as never,
    );
    for (const r of rows) {
      // Our own accounts are not students. An admin testing a class does not
      // belong in a list somebody rings people from.
      if (r.role && r.role !== "student") { staff.add(r.id); continue; }
      people.set(r.id, {
        name: r.full_name ?? "—", email: r.email ?? "", phone: r.phone ?? "",
        attempt: (r.target_attempt ?? "").trim(),
      });
    }
  }

  const attempts = [...new Set([...people.values()].map((p) => p.attempt).filter(Boolean))].sort();
  const wantAttempt = (sp.attempt ?? "").trim();
  const wantCourse = (sp.course ?? "").trim();

  const pool = doing.filter((e) => {
    if (staff.has(e.student_id)) return false;
    if (wantCourse && e.course_id !== wantCourse) return false;
    if (wantAttempt && (people.get(e.student_id)?.attempt ?? "") !== wantAttempt) return false;
    return true;
  });

  const qs = (over: { attempt?: string; course?: string }) => {
    const u = new URLSearchParams();
    const attempt = over.attempt ?? wantAttempt;
    const course = over.course ?? wantCourse;
    if (attempt) u.set("attempt", attempt);
    if (course) u.set("course", course);
    return u.toString() ? `?${u}` : "";
  };
  const chip = (label: string, href: string, on: boolean) => (
    <Link key={`${href}|${label}`} href={`/admin/reports/toppers${href}`}
      className={on ? "btn small" : "btn small secondary"} style={{ marginBottom: 0 }}>{label}</Link>
  );

  const overall = rank(pool);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1080 }}>
      <AdminHero
        badge="🏆 Leaderboards"
        title="Who is leading, and at what"
        subtitle="A board for each thing, with its leader named — classes, planner, mocks, written papers, marks, case studies and MCQs. Phone numbers included, because this is for mentoring. 🎯"
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      {/* THE DAILY ANNOUNCEMENT — the same message the 11:59/3 AM pair sends.
          Here so it can be seen before it goes out, and re-sent for a day the
          cron missed, without anybody needing the cron secret. */}
      <div className="card" style={{ marginTop: 14 }}>
        <strong style={{ fontSize: ".95rem" }}>🏆 Daily toppers announcement</strong>
        <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px", lineHeight: 1.6 }}>
          Decided on its own at <strong>11:59 PM</strong> and sent at <strong>3 AM</strong> to the Telegram channel,
          every subject group, Discord and all phones — names only, no marks. A day with no released copies is not
          announced at all. Counted on the day a copy was <strong>released</strong>, not written.
        </p>
        {sp.sent && <p className="notice ok" style={{ fontSize: ".82rem" }}>{sp.sent}</p>}
        {sp.preview && (
          <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg-soft)", padding: "12px 14px", borderRadius: 10, fontSize: ".85rem", margin: "0 0 10px" }}>
            {sp.preview}
          </pre>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: ".72rem" }}>Day (IST)</label>
            <input form="toppers-preview" name="day" type="date" defaultValue={sp.day ?? istDay()} style={{ marginBottom: 0 }} />
          </div>
          <form id="toppers-preview" action={previewToppers} style={{ margin: 0 }}>
            <SubmitButton className="btn small secondary">👁 Show me the message</SubmitButton>
          </form>
          <form action={sendToppersNow} style={{ margin: 0 }}>
            <input type="hidden" name="day" value={sp.day ?? istDay()} />
            <SubmitButton className="btn small">📣 Send it now</SubmitButton>
          </form>
          <span className="muted" style={{ fontSize: ".76rem" }}>
            Sending posts to every channel and marks the day announced, so 3 AM will not repeat it.
          </span>
        </div>
      </div>

      {/* Counted afresh on every open — never cached. Said out loud, with the
          clock to prove it, because boards that rank ALL-TIME totals move
          slowly: an unchanged leader looks like a page that stopped
          refreshing, when it is a lead that has not been overtaken. */}
      <p className="muted" style={{ fontSize: ".8rem", margin: "10px 2px 0" }}>
        Counted afresh just now —{" "}
        {new Date().toLocaleString("en-IN", {
          day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
          hour12: true, timeZone: "Asia/Kolkata",
        })}{" "}
        IST. Every open recalculates from the raw watching and test records; a class watched a minute
        ago is already in these figures. These are all-time totals, so the top of a board changes only
        when somebody is actually overtaken.
      </p>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: ".8rem", fontWeight: 700, minWidth: 74 }}>Attempt</span>
          {chip("All attempts", qs({ attempt: "" }), !wantAttempt)}
          {attempts.map((a) => chip(a, qs({ attempt: a }), wantAttempt === a))}
          {attempts.length === 0 && (
            <span className="muted" style={{ fontSize: ".82rem" }}>No student in this list has set a target attempt yet.</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: ".8rem", fontWeight: 700, minWidth: 74 }}>Course</span>
          {chip("Both", qs({ course: "" }), !wantCourse)}
          {[...courses.entries()].map(([id, title]) => chip(title, qs({ course: id }), wantCourse === id))}
        </div>
        <p className="muted" style={{ fontSize: ".8rem", margin: 0, lineHeight: 1.65 }}>
          <strong>{pool.length}</strong> record{pool.length === 1 ? "" : "s"} in view.
          Marks boards rank on <strong>percentage</strong>, not the raw total — 22 out of 40 beats 30 out of 100 —
          with a small minimum so one lucky 5 out of 5 cannot lead for ever. A paper still being marked is counted
          as submitted but has no score yet. Staff accounts are excluded.
        </p>
      </div>

      {/* ── One board per question ───────────────────────────────────────── */}
      {BOARDS.map((b) => {
        const all = boardRows(pool, b);
        const rows = all.slice(0, PER_BOARD);
        const leader = rows[0];
        const lp = leader ? people.get(leader.student_id) : null;
        return (
          <div key={b.key} style={{ marginTop: 28 }}>
            <h2 className="admin-section-title">{b.icon} {b.label}</h2>

            {rows.length === 0 ? (
              <div className="card"><p className="muted" style={{ margin: 0 }}>
                Nobody in this view has done one of these yet.
              </p></div>
            ) : (
              <>
                <div className="card" style={{ borderLeft: "4px solid var(--accent)", marginBottom: 10 }}>
                  <strong style={{ fontSize: "1.02rem" }}>
                    🏆 Leader — <Link href={`/admin/users/${leader.student_id}`}>{lp?.name || "—"}</Link>
                  </strong>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: ".86rem" }}>
                    {b.caption(leader)} · {courses.get(leader.course_id) ?? ""}
                    {lp?.attempt ? ` · 🎯 ${lp.attempt}` : ""}
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: ".86rem" }}>
                    {lp?.phone ? <>📞 <strong>{lp.phone}</strong></> : <span className="muted">no phone on file</span>}
                    {lp?.email ? <span className="muted"> · {lp.email}</span> : null}
                  </p>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ minWidth: 780, width: "100%", borderCollapse: "collapse", fontSize: ".86rem" }}>
                    <thead>
                      <tr>
                        {["#", "Student", "Attempt", "How they stand", "Course", "Phone", "Email"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e, i) => {
                        const p = people.get(e.student_id);
                        const td = { padding: "7px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" } as const;
                        return (
                          <tr key={`${b.key}:${e.student_id}:${e.course_id}`}>
                            <td style={td}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>
                            <td style={td}><Link href={`/admin/users/${e.student_id}`}>{p?.name || "—"}</Link></td>
                            <td style={td}>{p?.attempt || <span className="muted">—</span>}</td>
                            <td style={td}>{b.caption(e)}</td>
                            <td style={td}>{(courses.get(e.course_id) ?? "").replace("CA ", "")}</td>
                            <td style={td}>{p?.phone || <span className="muted">—</span>}</td>
                            <td style={{ ...td, wordBreak: "break-all" }}><span className="muted">{p?.email || "—"}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {all.length > PER_BOARD && (
                  <p className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>
                    Showing the top {PER_BOARD} of {all.length}.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* ── And everything together, on the weights he set ────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 34 }}>
        ⚖️ All of it together — classes {WEIGHTS.classes}, revisions {WEIGHTS.revisions},
        papers {WEIGHTS.tests}, case studies &amp; MCQ {WEIGHTS.practice}
      </h2>
      <p className="muted" style={{ fontSize: ".84rem", marginTop: -4, lineHeight: 1.6 }}>
        Out of 100, against everything available in the course — never against the other students, so nobody&apos;s
        rank moves because a stranger studied. Planner ticks are not counted here; they have their own board above.
      </p>
      {overall.length === 0 ? (
        <div className="card" style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: 0 }}>Nobody in this view yet.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ minWidth: 740, width: "100%", borderCollapse: "collapse", fontSize: ".86rem" }}>
            <thead>
              <tr>
                {["#", "Student", "Score", "Classes", "Revision", "Papers", "Case & MCQ", "Phone"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overall.slice(0, PER_BOARD).map((s, i) => {
                const p = people.get(s.student_id);
                const td = { padding: "7px 10px", borderBottom: "1px solid var(--border)" } as const;
                return (
                  <tr key={`w:${s.student_id}:${s.course_id}`}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}><Link href={`/admin/users/${s.student_id}`}>{p?.name || "—"}</Link></td>
                    <td style={{ ...td, fontWeight: 800 }}>{s.total}</td>
                    <td style={td}>{s.shown.classes}</td>
                    <td style={td}>{s.shown.revisions}</td>
                    <td style={td}>{s.shown.tests}</td>
                    <td style={td}>{s.shown.practice}</td>
                    <td style={td}>{p?.phone || <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
