import { Fragment } from "react";
import AdminHero from "../../_components/AdminHero";
import { createClient } from "@/lib/supabase/server";
import { loadPlanInput } from "@/lib/planner/load";
import { generatePlan } from "@/lib/planner/engine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan preview — Admin" };

const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function PlanPreviewPage({ searchParams }: { searchParams: { subject?: string; start?: string; exam?: string; done?: string; speed?: string; rev?: string } }) {
  const supabase = createClient();
  const { data: subjects } = await supabase.from("subjects").select("id, title, code").order("code");

  const sp = searchParams;
  const ready = sp.subject && sp.start && sp.exam;
  const plan = ready
    ? await (async () => {
        const input = await loadPlanInput({ subjectId: sp.subject!, startDate: sp.start!, examDate: sp.exam!, doneClasses: Number(sp.done) || 0 });
        if (!input) return null;
        input.chosenSpeed = Number(sp.speed) || undefined;
        input.revisionRounds = Number(sp.rev) || undefined;
        return generatePlan(input);
      })()
    : null;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero badge="🧪 Plan preview" title="Preview a generated plan" subtitle="Pick a subject + dates to see exactly what the engine produces — feasibility + the day-by-day schedule." back={{ href: "/admin/planner", label: "Study planner" }} />

      <form method="get" className="form-card" style={{ marginTop: 18, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", alignItems: "end" }}>
        <div>
          <label>Subject</label>
          <select name="subject" defaultValue={sp.subject ?? ""}>
            <option value="" disabled>Choose…</option>
            {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
        <div><label>Start date</label><input type="date" name="start" defaultValue={sp.start ?? ""} /></div>
        <div><label>Exam date</label><input type="date" name="exam" defaultValue={sp.exam ?? ""} /></div>
        <div><label>Classes already done</label><input type="number" name="done" min={0} defaultValue={sp.done ?? "0"} /></div>
        <div>
          <label>Watch speed</label>
          <select name="speed" defaultValue={sp.speed ?? "1.2"}>
            <option value="1.2">1.2×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </div>
        <div>
          <label>Revision rounds</label>
          <select name="rev" defaultValue={sp.rev ?? "3"}>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1</option>
          </select>
        </div>
        <button className="btn" type="submit">Generate preview</button>
      </form>

      {ready && !plan && <div className="notice" style={{ marginTop: 16 }}>Couldn&apos;t build a plan — check the subject has published topics/classes.</div>}

      {plan && (
        <>
          <div style={{ marginTop: 18, padding: "16px 18px", borderRadius: 12, background: plan.feasibility.fits ? "var(--bg-soft,#f0fdf4)" : "#fef2f2", border: `1px solid ${plan.feasibility.fits ? "#16a34a" : "#ef4444"}` }}>
            <strong>{plan.feasibility.fits ? "✅ Fits the target" : "⚠️ Short of time"}</strong>
            <div style={{ fontSize: ".88rem", marginTop: 6 }}>
              Content {plan.totals.classCount} classes · {plan.totals.classHours}h · suggested speed <strong>{plan.feasibility.speed}×</strong> · required {plan.feasibility.requiredHours}h vs available {plan.feasibility.availableHours}h.
            </div>
            <ul style={{ fontSize: ".85rem", margin: "8px 0 0", paddingLeft: 18 }}>
              {plan.feasibility.messages.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {plan.feasibility.recommendedSpeed && (
                <a className="btn small" href={`?subject=${sp.subject}&start=${sp.start}&exam=${sp.exam}&done=${sp.done ?? 0}&rev=${sp.rev ?? 3}&speed=${plan.feasibility.recommendedSpeed}`}>Try {plan.feasibility.recommendedSpeed}× →</a>
              )}
              {plan.feasibility.recommendedRounds && (
                <a className="btn small" href={`?subject=${sp.subject}&start=${sp.start}&exam=${sp.exam}&done=${sp.done ?? 0}&speed=${sp.speed ?? 1.2}&rev=${plan.feasibility.recommendedRounds}`}>Try {plan.feasibility.recommendedRounds} revision round(s) →</a>
              )}
            </div>
          </div>

          <p className="muted" style={{ fontSize: ".82rem", marginTop: 12 }}>
            Exhaustive {fmt(plan.timeline.exhaustiveStart)} → {fmt(plan.timeline.exhaustiveEnd)} · RR1 {fmt(plan.timeline.rr1[0])}–{fmt(plan.timeline.rr1[1])} · RR2 {fmt(plan.timeline.rr2[0])}–{fmt(plan.timeline.rr2[1])} · RR3 {fmt(plan.timeline.rr3[0])}–{fmt(plan.timeline.rr3[1])}
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13, marginTop: 10 }}>
            <colgroup><col style={{ width: "120px" }} /><col /><col style={{ width: "150px" }} /></colgroup>
            <thead><tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "6px" }}>Date &amp; day</th><th style={{ padding: "6px" }}>Today&apos;s target</th><th style={{ padding: "6px" }}>Topic</th>
            </tr></thead>
            <tbody style={{ verticalAlign: "top" }}>
              {plan.days.map((row, i) => {
                const header = i === 0 || plan.days[i - 1].stageLabel !== row.stageLabel;
                return (
                  <Fragment key={i}>
                    {header && (
                      <tr><td colSpan={3} style={{ padding: "10px 6px 4px", fontWeight: 500, color: "var(--accent)" }}>{row.stageLabel}</td></tr>
                    )}
                    {row.stage === "break" ? (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 6px", color: "var(--muted)" }}>—</td>
                        <td style={{ padding: "8px 6px", fontStyle: "italic", color: "var(--muted)" }} colSpan={2}>{row.task}</td>
                      </tr>
                    ) : (
                      <tr style={{ borderBottom: "1px solid var(--border)", background: row.status === "test" ? "var(--bg-soft,#f8fafc)" : undefined }}>
                        <td style={{ padding: "8px 6px" }}>{row.weekday}<br /><span style={{ color: "var(--muted)" }}>{fmt(row.date)}</span></td>
                        <td style={{ padding: "8px 6px" }}><strong>{row.task}</strong><br /><span style={{ fontStyle: "italic", fontSize: 12, color: "var(--muted)" }}>{row.meta}</span></td>
                        <td style={{ padding: "8px 6px", fontWeight: row.topic ? 500 : 400, color: row.topic ? undefined : "var(--muted)" }}>{row.topic ?? ""}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
