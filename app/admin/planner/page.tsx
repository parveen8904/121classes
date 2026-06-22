import AdminHero from "../_components/AdminHero";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "@/app/components/SubmitButton";
import { saveSubjectPlan, savePlannerConfig } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Study planner settings — Admin" };

function NumField({ label, name, value, step = "1", hint }: { label: string; name: string; value: number | null | undefined; step?: string; hint?: string }) {
  return (
    <div>
      <label style={{ fontSize: ".82rem" }}>{label}</label>
      <input name={name} type="number" step={step} min={0} defaultValue={value ?? ""} />
      {hint && <p className="muted" style={{ fontSize: ".72rem", margin: "2px 0 0" }}>{hint}</p>}
    </div>
  );
}

export default async function PlannerSettingsPage({ searchParams }: { searchParams: { saved?: string } }) {
  const supabase = createClient();
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, title, code, plan_start_months_before_exam, plan_max_months, plan_target_months, courses(title)")
    .order("code");

  const { data: cfgRow } = await supabase.from("site_settings").select("value").eq("key", "planner_config").maybeSingle();
  let cfg: any = {};
  try { cfg = JSON.parse(cfgRow?.value ?? "{}"); } catch { cfg = {}; }
  const rr1 = cfg.rr1 ?? {}, rr2 = cfg.rr2 ?? {}, rr3 = cfg.rr3 ?? {};

  const grid3: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="🗓️ Study planner"
        title="Study planner settings"
        subtitle="The rules the day-by-day plan engine follows. Change a number here and every new plan uses it. 🎛️"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.saved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Saved.</div>}

      <a href="/admin/planner/preview" className="card" style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none" }}>
        <span><strong>🧪 Preview a generated plan</strong> <span className="muted">— pick a subject + dates and see the day-by-day output</span></span>
        <span style={{ fontWeight: 800, color: "var(--accent)" }}>Open →</span>
      </a>

      <h2 className="admin-section-title" style={{ marginTop: 22 }}>📚 Per-subject — exhaustive window</h2>
      <p className="muted" style={{ fontSize: ".85rem" }}>How long before the exam the detailed-classes stage starts, its maximum length, and the target the engine tries to hit (by speeding up videos).</p>
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {(subjects ?? []).map((s) => (
          <form key={s.id} action={saveSubjectPlan} className="form-card">
            <input type="hidden" name="id" value={s.id} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <strong>{s.title} <span className="muted" style={{ fontWeight: 400 }}>· {(s as any).courses?.title}</span></strong>
            </div>
            <div style={{ ...grid3, marginTop: 10 }}>
              <NumField label="Starts (months before exam)" name="start_months" value={s.plan_start_months_before_exam as number} />
              <NumField label="Max months" name="max_months" value={s.plan_max_months as number} step="0.5" />
              <NumField label="Target months" name="target_months" value={s.plan_target_months as number} step="0.5" />
            </div>
            <SubmitButton className="btn small" style={{ marginTop: 10 }} savedLabel="✓ Saved">Save {s.code}</SubmitButton>
          </form>
        ))}
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>🎛️ Global rules — all stages</h2>
      <form action={savePlannerConfig} className="form-card" style={{ marginTop: 8 }}>
        <strong>Stage 1 · Exhaustive</strong>
        <div style={{ ...grid3, margin: "8px 0 16px" }}>
          <NumField label="Hours / day" name="ex_hours" value={cfg.exhaustive_daily_hours} step="0.5" hint="Sunday off (used for deep tests)" />
          <NumField label="Homework %" name="ex_homework" value={cfg.exhaustive_homework_pct} hint="done by student automatically" />
          <NumField label="Base video speed" name="base_speed" value={cfg.base_speed} step="0.1" />
          <NumField label="Max video speed" name="max_speed" value={cfg.max_speed} step="0.1" hint="ladder caps here, then warns" />
        </div>

        <strong>Stage 2 · Revision round 1</strong>
        <div style={{ ...grid3, margin: "8px 0 16px" }}>
          <NumField label="Starts (months before exam)" name="rr1_start" value={rr1.start_months_before} />
          <NumField label="Days" name="rr1_days" value={rr1.days} />
          <NumField label="Hours / day" name="rr1_hours" value={rr1.daily_hours} step="0.5" />
          <NumField label="Revision-video %" name="rr1_vpct" value={rr1.video_pct} />
          <NumField label="Video speed" name="rr1_vspeed" value={rr1.video_speed} step="0.1" />
        </div>

        <strong>Stage 3 · Revision round 2</strong>
        <div style={{ ...grid3, margin: "8px 0 16px" }}>
          <NumField label="Starts (months before exam)" name="rr2_start" value={rr2.start_months_before} />
          <NumField label="Days" name="rr2_days" value={rr2.days} />
          <NumField label="Hours / day" name="rr2_hours" value={rr2.daily_hours} step="0.5" />
          <NumField label="Revision-video %" name="rr2_vpct" value={rr2.video_pct} />
          <NumField label="Video speed" name="rr2_vspeed" value={rr2.video_speed} step="0.1" />
        </div>

        <strong>Stage 4 · Revision round 3</strong>
        <div style={{ ...grid3, margin: "8px 0 16px" }}>
          <NumField label="Days (ends on exam day)" name="rr3_days" value={rr3.days} />
          <NumField label="Hours / day" name="rr3_hours" value={rr3.daily_hours} step="0.5" />
          <NumField label="Video speed" name="rr3_vspeed" value={rr3.video_speed} step="0.1" />
        </div>
        <p className="muted" style={{ fontSize: ".76rem", margin: "0 0 10px" }}>Sundays are working days in all three revision rounds. Revision-video % = share of the day on videos; the rest goes to RTP / MTP / past papers / mock tests / most-important questions.</p>
        <SubmitButton className="btn" savedLabel="✓ Saved">Save global rules</SubmitButton>
      </form>
    </section>
  );
}
