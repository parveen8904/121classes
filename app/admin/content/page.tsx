import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { saveContent, saveAmendments } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Career & Amendments — Admin" };

const ATTEMPTS = ["May 2026", "Nov 2026", "May 2027", "Nov 2027"];

export default async function ContentPage({ searchParams }: { searchParams: { saved?: string } }) {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("key, value");
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const amend = (a: string) => {
    try { return JSON.parse(m.get(`amend:${a}`) || "{}"); } catch { return {}; }
  };
  let pc: Record<string, number> = {};
  try { pc = JSON.parse(m.get("planner_config") || "{}"); } catch {}

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero badge="🧭 Career & Amendments" title="Career corner, amendments & wellness"
        subtitle="Content students see in their Career Corner, 'Know your amendments', and the daily wellness tip."
        back={{ href: "/admin", label: "Admin" }} />

      {searchParams.saved === "1" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Saved.</div>}

      {/* CAREER + WELLNESS */}
      <form action={saveContent} className="form-card" style={{ marginTop: 18 }}>
        <h3>🎓 Career corner</h3>
        <label>Articleship guidance</label>
        <textarea name="career_articleship" rows={4} defaultValue={m.get("career_articleship") || ""} placeholder="How to find articleship, what to look for, CA firm guidance…" />
        <label>Placement &amp; interviews</label>
        <textarea name="career_placement" rows={4} defaultValue={m.get("career_placement") || ""} placeholder="Placement process, mock interview tips, CV pointers…" />
        <label>Career resources / links</label>
        <textarea name="career_resources" rows={3} defaultValue={m.get("career_resources") || ""} placeholder="Useful links, opportunities, community…" />
        <label>Job / articleship openings — one per line as <code>Title | Firm | Location | apply link or email</code></label>
        <textarea name="career_jobs" rows={5} defaultValue={m.get("career_jobs") || ""} placeholder={"CA Articleship | XYZ & Co | Gurugram | careers@xyz.com\nAudit Associate | ABC LLP | Delhi | https://abc.com/apply"} />
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>Each opening shows on the Career page with an &ldquo;Apply&rdquo; button linking where you point it.</p>

        <label style={{ marginTop: 12 }}>🔗 Browse-&amp;-apply links — one per line as <code>Label | URL</code> (leave blank to use the defaults)</label>
        <textarea name="career_links" rows={4} defaultValue={m.get("career_links") || ""} placeholder={"Naukri — CA jobs | https://www.naukri.com/chartered-accountant-jobs\nXYZ & Co (walk-in) | https://xyz.com/careers"} />
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>Quick links shown on the Career page so students can browse openings &amp; walk-ins directly on Google Jobs, Naukri, Monster, ICAI and specific CA-firm career pages. Add your own firm links here.</p>

        <h3 style={{ marginTop: 18 }}>🧘 Daily wellness tips</h3>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>One tip per line — students see one per day (rotates).</p>
        <textarea name="wellness_tips" rows={5} defaultValue={m.get("wellness_tips") || ""} placeholder={"Take a 10-min walk between study blocks.\nRevise yesterday's topic for 15 min before new material.\nSleep 7 hours — memory consolidates at night."} />

        <h3 style={{ marginTop: 18 }}>🗓️ Planner cadence (drives each student&apos;s day-by-day plan)</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div><label>Avg minutes per class</label><input name="classMinutes" type="number" defaultValue={pc.classMinutes ?? 60} /></div>
          <div><label>MCQ test after every N classes</label><input name="mcqEveryClasses" type="number" defaultValue={pc.mcqEveryClasses ?? 5} /></div>
          <div><label>Descriptive test after every N classes</label><input name="descEveryClasses" type="number" defaultValue={pc.descEveryClasses ?? 10} /></div>
          <div><label>Full mock tests (in 2nd revision)</label><input name="mockCount" type="number" defaultValue={pc.mockCount ?? 3} /></div>
          <div><label>Buffer days kept free before exam</label><input name="revisionDays" type="number" defaultValue={pc.revisionDays ?? 5} /></div>
        </div>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
          The plan now builds three stages automatically — exhaustive study, first revision (25% of study time) and second revision (≈12.5%). &ldquo;Buffer days&rdquo; is the gap left free right before the exam.
        </p>

        <SubmitButton className="btn" style={{ marginTop: 12 }}>Save career, wellness &amp; planner</SubmitButton>
      </form>

      {/* AMENDMENTS PER ATTEMPT */}
      <form action={saveAmendments} className="form-card" style={{ marginTop: 18 }}>
        <h3>📜 Know your amendments (per attempt)</h3>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
          For each attempt: the cut-off date (last date amendments can still be added), what&apos;s applicable so far, and what&apos;s expected.
        </p>
        {ATTEMPTS.map((a) => {
          const v = amend(a);
          return (
            <div key={a} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
              <strong>{a}</strong>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 6 }}>
                <div>
                  <label>Amendments cut-off date</label>
                  <input name={`cutoff:${a}`} defaultValue={v.cutoff || ""} placeholder="e.g. 31 Oct 2025" />
                </div>
              </div>
              <label style={{ marginTop: 8 }}>Applicable amendments so far</label>
              <textarea name={`applicable:${a}`} rows={3} defaultValue={v.applicable || ""} placeholder="List the amendments applicable for this attempt…" />
              <label>Expected / upcoming (if you change to this attempt)</label>
              <textarea name={`expected:${a}`} rows={2} defaultValue={v.expected || ""} placeholder="Amendments expected before the cut-off…" />
            </div>
          );
        })}
        <SubmitButton className="btn" style={{ marginTop: 14 }}>Save amendments</SubmitButton>
      </form>
    </section>
  );
}
