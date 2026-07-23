import Link from "next/link";
import SubmitButton from "@/app/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import { zoomConfigured } from "@/lib/zoom";
import {
  updateLiveSchedule,
  createZoomForLive,
  createLiveSession,
  updateLiveSession,
  deleteLiveSession,
} from "./actions";

type LiveRow = {
  id: string;
  title: string;
  is_published: boolean;
  config: Record<string, string> | null;
  topic_id: string;
  topics: { title: string; subjects: { title: string; courses: { title: string } | null } | null } | null;
};

export default async function AdminLivePage(
  props: {
    searchParams: Promise<{ zoom?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const zoomOn = zoomConfigured();
  const { data } = await supabase
    .from("sections")
    .select("id, title, is_published, config, topic_id, topics(title, subjects(title, courses(title)))")
    .eq("type", "live_class")
    .order("title");

  // Standalone scheduled classes (service client so drafts are visible too).
  const svc = createServiceClient();
  const { data: sessions } = await svc
    .from("live_sessions")
    .select("id, title, audience, starts_at, join_url, recording_url, is_published, faculty_id")
    .order("starts_at", { ascending: false });
  const { data: faculties } = await svc.from("faculties").select("id, full_name").order("full_name");
  const facList = (faculties ?? []) as { id: string; full_name: string }[];

  const rows = ((data ?? []) as unknown as LiveRow[]).map((r) => {
    const c = (r.config ?? {}) as Record<string, string>;
    const when = c.starts_at ? new Date(c.starts_at) : null;
    return {
      id: r.id,
      title: r.title,
      published: r.is_published,
      topicId: r.topic_id,
      course: r.topics?.subjects?.courses?.title ?? "Course",
      topic: r.topics?.title ?? "",
      when: when && !isNaN(when.getTime()) ? when : null,
      starts_at: c.starts_at ?? "",
      join_url: c.join_url ?? "",
      recording_url: c.recording_url ?? "",
    };
  });
  rows.sort((a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📡 Live classes"
        title="Live classes"
        subtitle="Schedule every live session in one place — paste the Zoom/Meet link & time, then add the recording after. 🎥"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.zoom && (
        <div
          className={`notice ${searchParams.zoom === "created" ? "ok" : "err"}`}
          style={{ marginTop: 16 }}
        >
          {searchParams.zoom === "created"
            ? "🎥 Zoom link created and saved."
            : searchParams.zoom === "unconfigured"
              ? "Zoom isn't connected yet — add ZOOM_* keys in Vercel, or just paste a link manually."
              : "Couldn't reach Zoom. Check your keys, or paste a link manually."}
        </div>
      )}

      {/* Standalone scheduled live classes (not tied to a course) */}
      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ Schedule a live class</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <h3>📅 Schedule a standalone live class</h3>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 0, marginBottom: 10 }}>
            For a Zoom/Meet class not tied to a course. Shows on the student Live page and the landing page.
          </p>
          <form action={createLiveSession}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
              <div>
                <label>Title</label>
                <input name="title" placeholder="e.g. FR Doubt-Solving Marathon" required />
              </div>
              <div>
                <label>For whom (audience)</label>
                <input name="audience" placeholder="CA Final FR batch / All students" />
              </div>
            </div>
            <label>Faculty taking the class</label>
            <select name="faculty_id" defaultValue="">
              <option value="">— select faculty —</option>
              {facList.map((f) => <option key={f.id} value={f.id}>{f.full_name}</option>)}
            </select>
            <label>Description (optional)</label>
            <input name="description" placeholder="What the session covers" />
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1.2fr 0.6fr 1.4fr" }}>
              <div>
                <label>Starts at</label>
                <input type="datetime-local" name="starts_at" />
              </div>
              <div>
                <label>Minutes</label>
                <input type="number" name="duration_mins" defaultValue={60} />
              </div>
              <div>
                <label>Join link (fallback only)</label>
                <input name="join_url" placeholder="https://…" />
              </div>
            </div>
            <div style={{ border: "1px solid var(--accent)", borderRadius: 10, padding: "10px 12px", marginTop: 8, background: "var(--bg-soft)" }}>
              <strong style={{ fontSize: ".9rem" }}>🔒 White-label (recommended) — students watch inside our site, never see Zoom</strong>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr", marginTop: 8 }}>
                <div><label>Zoom meeting / webinar number</label><input name="zoom_meeting_number" placeholder="e.g. 812 3456 7890" /></div>
                <div><label>Passcode (if any)</label><input name="zoom_passcode" placeholder="optional" /></div>
              </div>
              <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>Paste the meeting number from Zoom. Students then join at caparveensharma.com — no zoom.us link is shown. Needs the Zoom SDK Key/Secret on Integrations.</p>
            </div>
            <label className="remember" style={{ marginTop: 8 }}>
              <input type="checkbox" name="is_published" defaultChecked /> Published (visible to students + landing)
            </label>
            <SubmitButton className="btn">
              Schedule class
            </SubmitButton>
          </form>
        </div>
      </details>

      {sessions && sessions.length > 0 && (
        <>
          <h2 className="admin-section-title">📅 Scheduled live classes</h2>
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {sessions.map((s) => (
              <div className="card" key={s.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>📅 {s.title}</strong>
                    <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                      {s.audience ? s.audience + " · " : ""}
                      {s.starts_at
                        ? new Date(s.starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                        : "Time TBA"}
                      {" · "}
                      {s.is_published ? "🟢 published" : "⚪ draft"}
                    </p>
                  </div>
                  <DeleteButton action={deleteLiveSession} id={s.id} message="Delete this scheduled class?" />
                </div>
                <form action={updateLiveSession} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={s.id} />
                  <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                    <div>
                      <label>Join link</label>
                      <input name="join_url" defaultValue={s.join_url ?? ""} placeholder="https://…" />
                    </div>
                    <div>
                      <label>Recording link (after)</label>
                      <input name="recording_url" defaultValue={s.recording_url ?? ""} placeholder="https://…" />
                    </div>
                  </div>
                  <label className="remember" style={{ marginTop: 0 }}>
                    <input type="checkbox" name="is_published" defaultChecked={s.is_published} /> Published
                  </label>
                  <SubmitButton className="btn small">
                    Save
                  </SubmitButton>
                </form>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="admin-section-title" style={{ marginTop: 28 }}>🎥 Course live classes (inside topics)</h2>
      <p className="muted" style={{ marginTop: 4, fontSize: ".9rem" }}>
        These are <strong>Live class</strong> sections inside courses. Create more by adding a Live class
        section inside any topic.
        {zoomOn && " Use “Auto-create Zoom link” to generate a meeting automatically."}
      </p>

      <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
        {rows.length > 0 ? (
          rows.map((x) => (
            <div className="card" key={x.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>📡 {x.title}</strong>
                  <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                    {x.course} · {x.topic} · {x.published ? "🟢 published" : "⚪ draft"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {zoomOn && (
                    <form action={createZoomForLive} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={x.id} />
                      <SubmitButton className="btn small">
                        🎥 Auto-create Zoom link
                      </SubmitButton>
                    </form>
                  )}
                  <Link className="btn small secondary" href={`/admin/topics/${x.topicId}`}>
                    Open topic →
                  </Link>
                </div>
              </div>

              <form action={updateLiveSchedule} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={x.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label>Starts at</label>
                    <input type="datetime-local" name="starts_at" defaultValue={x.starts_at} />
                  </div>
                  <div>
                    <label>Join link (Zoom / Meet)</label>
                    <input name="join_url" defaultValue={x.join_url} placeholder="https://…" />
                  </div>
                </div>
                <label>Recording link (after the class)</label>
                <input name="recording_url" defaultValue={x.recording_url} placeholder="https://… (optional)" />
                <SubmitButton className="btn small">
                  Save schedule
                </SubmitButton>
              </form>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">
              📭 No live classes yet. Add a <strong>Live class</strong> section inside a topic, then it
              shows up here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
