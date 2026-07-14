import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadPlanInput, applySetup, type PlanSetup } from "@/lib/planner/load";
import { generatePlan } from "@/lib/planner/engine";
import SubmitButton from "@/app/components/SubmitButton";
import RemarkBox from "./RemarkBox";
import PrintButton from "./PrintButton";
import TopicPicker from "./TopicPicker";
import { savePlanSetup, clearPlan, emailMyPlan, rebalanceFromToday } from "./actions";
import DoneToggle from "./DoneToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Study planner — CA Parveen Sharma" };

const todayISO = () => new Date().toISOString().slice(0, 10);
// No weekday here — the row already prints the weekday above the date.
const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

type Setup = PlanSetup;

export default async function PlannerPage({ searchParams }: { searchParams: { new?: string; emailed?: string; rebalanced?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/planner");

  const { data: myCourses } = await supabase.from("my_courses").select("course_id").eq("student_id", user.id);
  const courseIds = (myCourses ?? []).map((r) => r.course_id as string);
  const { data: subjOpts } = courseIds.length
    ? await supabase.from("subjects").select("id, title").in("course_id", courseIds).order("order_index")
    : await supabase.from("subjects").select("id, title").order("title");

  const { data: planRow } = await supabase.from("study_plans").select("setup, remarks").eq("user_id", user.id).maybeSingle();
  const setup = (planRow?.setup ?? null) as Setup | null;
  const remarks = (planRow?.remarks ?? {}) as Record<string, string>;
  const showForm = !setup?.subjectId || searchParams.new === "1";

  if (showForm) {
    const subjIds = (subjOpts ?? []).map((s) => s.id as string);
    const { data: allTopics } = subjIds.length
      ? await supabase.from("topics").select("id, title, subject_id").in("subject_id", subjIds).eq("is_combined", false).order("order_index")
      : { data: [] as { id: string; title: string; subject_id: string }[] };
    const topicsBySubject: Record<string, { id: string; title: string }[]> = {};
    for (const t of allTopics ?? []) (topicsBySubject[t.subject_id as string] ??= []).push({ id: t.id as string, title: t.title as string });
    return (
      <main className="container" style={{ paddingTop: 36, paddingBottom: 60, maxWidth: 720 }}>
        <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <span className="badge">🗓️ Study planner</span>
        <h1 style={{ margin: "12px 0 4px" }}>Build your study plan</h1>
        <p className="muted">Pick your subject and dates — we&apos;ll lay out exactly what to do each day, through to exam day.</p>

        <form action={savePlanSetup} className="form-card" style={{ marginTop: 18, display: "grid", gap: 14 }}>
          <TopicPicker
            subjects={(subjOpts ?? []).map((s) => ({ id: s.id as string, title: s.title as string }))}
            topicsBySubject={topicsBySubject}
            defaultSubjectId={setup?.subjectId ?? ""}
            pickedIds={setup?.pickedTopicIds ?? []}
          />
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div><label>Start date</label><input type="date" name="start" defaultValue={setup?.startDate ?? todayISO()} required /></div>
            <div><label>Exam date</label><input type="date" name="exam" defaultValue={setup?.examDate ?? ""} required /></div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Watch classes at</label>
              {/* Only speeds the Bunny player actually offers (1.2 was never a player option). */}
              <select name="speed" defaultValue={setup?.speed && setup.speed !== 1.2 ? String(setup.speed) : "1.25"}>
                <option value="1.25">1.25× (recommended)</option>
                <option value="1">1× (normal)</option>
                <option value="1.5">1.5×</option>
                <option value="1.75">1.75×</option>
                <option value="2">2× (fastest)</option>
              </select>
            </div>
            <div>
              <label>Classes already done</label>
              <input type="number" name="done" min={0} defaultValue={setup?.doneClasses ?? 0} />
            </div>
          </div>
          <div>
            <label>How many revision rounds?</label>
            <select name="revisions" defaultValue={String(setup?.revisions ?? 3)}>
              <option value="3">3 — full (Revision 1 + 2 + final)</option>
              <option value="2">2 — drop the middle round (Revision 1 + final)</option>
              <option value="1">1 — final revision only (most time for classes)</option>
            </select>
            <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0" }}>Short on time? Fewer revisions frees up days for your detailed classes.</p>
          </div>
          <div>
            <label>Detailed classes (exhaustive) — which topics?</label>
            <select name="ex_scope" defaultValue={setup?.exhaustiveScope ?? "all"}>
              <option value="all">All topics</option>
              <option value="ab">Important only — A + B</option>
              <option value="a">Most important only — A</option>
              <option value="skip">Skip — I&apos;ve already done the detailed classes</option>
            </select>
            <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0" }}>Re-attempt? Choose A-only for a quick brush-up, or Skip to go straight to revision.</p>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Revision 1 covers</label>
              <select name="rev1_scope" defaultValue={setup?.revScope1 ?? "all"}><option value="all">All topics</option><option value="ab">A + B</option><option value="a">A only</option></select>
            </div>
            <div>
              <label>Revision 2 covers</label>
              <select name="rev2_scope" defaultValue={setup?.revScope2 ?? "all"}><option value="all">All topics</option><option value="ab">A + B</option><option value="a">A only</option></select>
            </div>
          </div>
          <details>
            <summary className="muted" style={{ cursor: "pointer", fontSize: ".85rem" }}>Advanced — stage lengths &amp; pick exact topics</summary>
            <div style={{ marginTop: 10 }}>
              <label>Stage lengths (days) — leave blank for the standard</label>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))" }}>
                <div><label style={{ fontSize: ".76rem" }}>Exhaustive</label><input type="number" name="d_ex" min={1} defaultValue={setup?.stageDays?.exhaustive ?? ""} placeholder="auto" /></div>
                <div><label style={{ fontSize: ".76rem" }}>Revision 1</label><input type="number" name="d_rr1" min={1} defaultValue={setup?.stageDays?.rr1 ?? ""} placeholder="20" /></div>
                <div><label style={{ fontSize: ".76rem" }}>Revision 2</label><input type="number" name="d_rr2" min={1} defaultValue={setup?.stageDays?.rr2 ?? ""} placeholder="10" /></div>
                <div><label style={{ fontSize: ".76rem" }}>Final</label><input type="number" name="d_rr3" min={1} defaultValue={setup?.stageDays?.rr3 ?? ""} placeholder="5" /></div>
              </div>
              <label className="remember" style={{ marginTop: 10 }}>
                <input type="checkbox" name="sundays_on" defaultChecked={!!setup?.sundaysOn} /> Study on Sundays too (no weekly rest day)
              </label>
              <label style={{ marginTop: 8 }}>Holidays — days to skip (yyyy-mm-dd, comma/space separated)</label>
              <textarea name="holidays" rows={2} defaultValue={(setup?.holidays ?? []).join(", ")} placeholder="2026-01-26, 2026-03-14" />
              <label style={{ marginTop: 8 }}>Extra working days — e.g. a Sunday you&apos;ll study (yyyy-mm-dd)</label>
              <textarea name="extra_days" rows={2} defaultValue={(setup?.extraDays ?? []).join(", ")} placeholder="2026-02-15" />
            </div>
          </details>
          <SubmitButton className="btn" savedLabel="✓ Building…">Generate my plan</SubmitButton>
        </form>
        {setup?.subjectId && <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>Your watched classes stay tracked automatically when you regenerate.</p>}
      </main>
    );
  }

  const input = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate, doneClasses: setup.doneClasses });
  if (!input) {
    return (
      <main className="container" style={{ paddingTop: 36, paddingBottom: 60, maxWidth: 720 }}>
        <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <div className="notice" style={{ marginTop: 12 }}>We couldn&apos;t build your plan — this subject has no published classes yet. <Link href="/planner?new=1">Pick another subject →</Link></div>
      </main>
    );
  }
  applySetup(input, setup);
  const plan = generatePlan(input);
  const subjectTitle = (subjOpts ?? []).find((s) => s.id === setup.subjectId)?.title ?? input.subjectTitle;

  const { data: cw } = await supabase.from("class_watch").select("section_id").eq("student_id", user.id).eq("completed", true);
  const completedIds = new Set((cw ?? []).map((r) => r.section_id as string));
  const svc = createServiceClient();
  const { data: subjTopics } = await svc.from("topics").select("id").eq("subject_id", setup.subjectId);
  const tIds = (subjTopics ?? []).map((t) => t.id as string);
  const { data: subjClasses } = tIds.length ? await svc.from("sections").select("id").eq("type", "full_class_video").in("topic_id", tIds) : { data: [] as { id: string }[] };
  const watched = (subjClasses ?? []).filter((s) => completedIds.has(s.id as string)).length;
  const done = Math.max(watched, setup.doneClasses);

  const today = todayISO();
  const classRowsByToday = plan.days.filter((day) => day.stage === "exhaustive" && day.status === "ok" && day.date <= today).length;
  const targetByToday = setup.doneClasses + classRowsByToday;
  const delta = done - targetByToday;
  const todays = plan.days.filter((day) => day.date === today && day.stage !== "break");

  // Group into ONE box per date (a date may hold more than one class); break
  // rows stay standalone. Each date gets a single remarks box.
  type Line = { task: string; meta: string; sectionId?: string };
  type Grp =
    | { kind: "date"; stageLabel: string; date: string; weekday: string; isTest: boolean; lines: Line[] }
    | { kind: "break"; stageLabel: string; task: string };
  const groups: Grp[] = [];
  for (const dRow of plan.days) {
    if (dRow.stage === "break") { groups.push({ kind: "break", stageLabel: dRow.stageLabel, task: dRow.task }); continue; }
    const line: Line = { task: dRow.task, meta: dRow.meta, sectionId: dRow.sectionId };
    const last = groups[groups.length - 1];
    if (last && last.kind === "date" && last.date === dRow.date) last.lines.push(line);
    else groups.push({ kind: "date", stageLabel: dRow.stageLabel, date: dRow.date, weekday: dRow.weekday, isTest: dRow.status === "test", lines: [line] });
  }

  return (
    <main className="container" style={{ paddingTop: 36, paddingBottom: 60, maxWidth: 900 }}>
      <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
      <span className="badge">🗓️ Study planner</span>
      <h1 style={{ margin: "12px 0 2px" }}>{subjectTitle}</h1>
      <p className="muted">Exam {fmt(setup.examDate)} · watching at {setup.speed}× · {plan.totals.classCount} classes left</p>

      {searchParams.emailed && <div className="notice ok no-print" style={{ marginTop: 12 }}>📧 Your plan has been emailed to you.</div>}
      {searchParams.rebalanced && <div className="notice ok no-print" style={{ marginTop: 12 }}>🔄 Plan re-balanced from today — remaining work spread over the days left.</div>}

      <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <a className="btn small secondary" href="/learn/pdf?u=%2Fapi%2Fplan-pdf&t=My study plan">⬇️ Download PDF</a>
        <PrintButton />
        <form action={emailMyPlan}><button type="submit" className="btn small secondary">📧 Email me my plan (PDF)</button></form>
        <form action={rebalanceFromToday}><button type="submit" className="btn small secondary">🔄 Re-balance from today</button></form>
      </div>

      <div className="card" style={{ marginTop: 16, border: "2px solid var(--accent)" }}>
        <strong style={{ fontSize: "1.1rem" }}>🎯 Today&apos;s target</strong>
        {todays.length ? (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {todays.map((day, i) => (
              <div key={i}>
                <strong>{day.task}</strong>
                <div className="muted" style={{ fontStyle: "italic", fontSize: ".82rem" }}>{day.meta}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>No class scheduled today — revise, or study your other subjects.</p>
        )}
      </div>

      <div className="card" style={{ marginTop: 12, borderColor: delta < 0 ? "#ef4444" : "#16a34a" }}>
        <strong style={{ color: delta < 0 ? "#b91c1c" : "#16a34a" }}>
          {delta < 0 ? `⚠️ ${Math.abs(delta)} class(es) behind` : delta > 0 ? `🚀 ${delta} class(es) ahead` : "✅ On track"}
        </strong>
        <p className="muted" style={{ fontSize: ".85rem", margin: "6px 0 0" }}>
          You&apos;ve completed <strong>{done}</strong> classes; by today the plan expects about <strong>{targetByToday}</strong>.
          {delta < 0 ? " Catch up the pending classes above, add hours, or regenerate with more time." : ""}
        </p>
      </div>

      {plan.feasibility.messages.length > 0 && (
        <div className="card" style={{ marginTop: 12, background: plan.feasibility.fits ? undefined : "#fef2f2" }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: ".88rem" }}>
            {plan.feasibility.messages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          {plan.feasibility.recommendedSpeed && (
            <Link className="btn small" href="/planner?new=1" style={{ marginTop: 8, display: "inline-block" }}>Change speed / dates →</Link>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "20px 0 8px", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1.15rem", margin: 0 }}>📅 Full plan</h2>
        <Link href="/planner?new=1" className="btn small secondary no-print">Change / regenerate</Link>
        <form action={clearPlan} className="no-print"><button className="btn small secondary" type="submit">Delete plan</button></form>
      </div>

      <table className="plan-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
        <colgroup><col style={{ width: "110px" }} /><col /><col style={{ width: "210px" }} /></colgroup>
        <thead><tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
          <th style={{ padding: "6px" }}>Date &amp; day</th><th style={{ padding: "6px" }}>Target</th><th style={{ padding: "6px" }}>Remarks</th>
        </tr></thead>
        <tbody style={{ verticalAlign: "top" }}>
          {groups.map((g, i) => {
            const header = i === 0 || groups[i - 1].stageLabel !== g.stageLabel;
            return (
              <Fragment key={i}>
                {header && <tr><td colSpan={3} style={{ padding: "10px 6px 4px", fontWeight: 500, color: "var(--accent)" }}>{g.stageLabel}</td></tr>}
                {g.kind === "break" ? (
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 6px", color: "var(--muted)" }}>—</td>
                    <td style={{ padding: "8px 6px", fontStyle: "italic", color: "var(--muted)" }} colSpan={2}>{g.task}</td>
                  </tr>
                ) : (
                  <tr style={{ borderBottom: "1px solid var(--border)", background: g.date === today ? "color-mix(in srgb, var(--accent) 12%, transparent)" : g.isTest ? "var(--bg-soft,#f8fafc)" : undefined }}>
                    <td style={{ padding: "8px 6px" }}>{g.weekday}<br /><span style={{ color: "var(--muted)" }}>{fmt(g.date)}</span></td>
                    <td style={{ padding: "8px 6px" }}>
                      {g.lines.map((l, j) => (
                        <div key={j} style={{ marginBottom: j < g.lines.length - 1 ? 8 : 0 }}>
                          {l.sectionId ? (
                            <DoneToggle sectionId={l.sectionId} initialDone={completedIds.has(l.sectionId)} task={l.task} meta={l.meta} />
                          ) : (
                            <>
                              <strong>{l.task}</strong>
                              <br /><span style={{ fontStyle: "italic", fontSize: 12, color: "var(--muted)" }}>{l.meta}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: "8px 6px" }}><RemarkBox date={g.date} initial={remarks[g.date] ?? ""} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
