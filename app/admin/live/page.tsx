import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import { zoomConfigured } from "@/lib/zoom";
import { updateLiveSchedule, createZoomForLive } from "./actions";

type LiveRow = {
  id: string;
  title: string;
  is_published: boolean;
  config: Record<string, string> | null;
  topic_id: string;
  topics: { title: string; subjects: { title: string; courses: { title: string } | null } | null } | null;
};

export default async function AdminLivePage({
  searchParams,
}: {
  searchParams: { zoom?: string };
}) {
  const supabase = createClient();
  const zoomOn = zoomConfigured();
  const { data } = await supabase
    .from("sections")
    .select("id, title, is_published, config, topic_id, topics(title, subjects(title, courses(title)))")
    .eq("type", "live_class")
    .order("title");

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

      <p className="muted" style={{ marginTop: 18, fontSize: ".9rem" }}>
        These are all your <strong>Live class</strong> sections. Create more by adding a Live class
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
                      <button className="btn small" type="submit">
                        🎥 Auto-create Zoom link
                      </button>
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
                <button className="btn small" type="submit">
                  Save schedule
                </button>
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
