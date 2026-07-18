import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../_components/DeleteButton";
import { generateSchedule, deleteScheduled, clearUpcoming, markDone } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Class schedule — Admin" };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Batch livestream planner: schedule up to 100 recorded classes at fixed times
// so each day the studio knows exactly which class to play on Zoom.
export default async function SchedulePage() {
  const svc = createServiceClient();
  const [{ data: subjects }, { data: upcoming }] = await Promise.all([
    svc.from("subjects").select("id, title").order("order_index"),
    svc.from("class_schedule").select("*").gte("scheduled_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).order("scheduled_at").limit(200),
  ]);
  const subjTitle = new Map((subjects ?? []).map((s) => [s.id as string, s.title as string]));

  const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const istDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const todayIST = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📅 Class schedule"
        title="Livestream class planner"
        subtitle="Schedule up to 100 recorded classes in one go — each day the studio plays the scheduled class on Zoom for the batch. Students see the upcoming schedule on the Live page. 🎥"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Bulk generator */}
      <form action={generateSchedule} className="form-card" style={{ marginTop: 20 }}>
        <strong>✨ Generate a schedule</strong>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
          <div>
            <label htmlFor="sc-subject">Subject</label>
            <select id="sc-subject" name="subject_id" required>
              {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sc-batch">Batch name (shown to students)</label>
            <input id="sc-batch" name="batch" placeholder="e.g. Nov 2026 Morning Batch" />
          </div>
        </div>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr 1fr", marginTop: 4 }}>
          <div>
            <label htmlFor="sc-start">Start date</label>
            <input id="sc-start" name="start_date" type="date" required />
          </div>
          <div>
            <label htmlFor="sc-time">Time (IST)</label>
            <input id="sc-time" name="time" type="time" defaultValue="18:00" required />
          </div>
          <div>
            <label htmlFor="sc-from">From class no.</label>
            <input id="sc-from" name="from_class" type="number" min={1} defaultValue={1} />
          </div>
          <div>
            <label htmlFor="sc-count">How many classes</label>
            <input id="sc-count" name="count" type="number" min={1} max={100} defaultValue={100} />
          </div>
        </div>
        <label style={{ marginTop: 4 }}>Class days</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {DAY_NAMES.map((d, i) => (
            <label key={d} className="remember" style={{ margin: 0 }}>
              <input type="checkbox" name={`day_${i}`} defaultChecked={i >= 1 && i <= 6} /> {d}
            </label>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <label htmlFor="sc-join">Zoom join link (optional — shown to the batch)</label>
          <input id="sc-join" name="join_url" placeholder="https://zoom.us/j/… (can be added later)" />
        </div>
        <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 12px" }}>
          Classes are taken in class-number order from the subject and placed one per selected day. Example: start Monday,
          days Mon–Sat, 100 classes → the full schedule lands automatically; play the day&apos;s class from the studio machine on Zoom.
        </p>
        <SubmitButton className="btn" savedLabel="✓ Scheduled">📅 Generate schedule</SubmitButton>
      </form>

      {/* Upcoming */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "26px 0 8px" }}>
        <h2 className="admin-section-title" style={{ margin: 0 }}>⏳ Upcoming ({(upcoming ?? []).length})</h2>
        <form action={clearUpcoming}>
          <SubmitButton className="btn small secondary">🗑 Clear all upcoming</SubmitButton>
        </form>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {(upcoming ?? []).length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing scheduled yet.</p></div>}
        {(upcoming ?? []).map((r) => {
          const isToday = istDate(r.scheduled_at as string) === todayIST;
          return (
            <div key={r.id as string} className="list-row" style={isToday ? { border: "2px solid var(--accent)" } : undefined}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="row-title">{isToday ? "🔴 TODAY · " : ""}🎥 Class {r.class_no as string} — {r.title as string}</span>
                <p className="row-sub">
                  🕕 {ist(r.scheduled_at as string)} IST · 📚 {subjTitle.get(r.subject_id as string) ?? ""}
                  {r.batch ? ` · 👥 ${r.batch as string}` : ""}
                  {r.status === "done" ? " · ✅ played" : ""}
                </p>
              </div>
              <div className="row-actions">
                {r.join_url ? <a className="btn small secondary" href={r.join_url as string} target="_blank" rel="noopener noreferrer">🔗 Zoom</a> : null}
                {r.status !== "done" && (
                  <form action={markDone} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={r.id as string} />
                    <SubmitButton className="btn small secondary">✓ Played</SubmitButton>
                  </form>
                )}
                <DeleteButton action={deleteScheduled} id={r.id as string} message="Remove this class from the schedule?" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
