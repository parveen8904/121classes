import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type LiveRow = {
  id: string;
  title: string;
  config: Record<string, string> | null;
  topic_id: string;
  topics: { title: string; subjects: { title: string; courses: { title: string } | null } | null } | null;
};

function shape(rows: LiveRow[]) {
  return rows.map((r) => {
    const c = (r.config ?? {}) as Record<string, string>;
    const when = c.starts_at ? new Date(c.starts_at) : null;
    return {
      id: r.id,
      title: r.title,
      topicId: r.topic_id,
      course: r.topics?.subjects?.courses?.title ?? "Course",
      subject: r.topics?.subjects?.title ?? "",
      topic: r.topics?.title ?? "",
      when: when && !isNaN(when.getTime()) ? when : null,
      join: c.join_url || "",
      recording: c.recording_url || "",
    };
  });
}

function whenLabel(d: Date | null): string {
  return d ? d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Time to be announced";
}

export default async function LivePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/live");

  // RLS returns only live classes the student may access (free or subscribed).
  const { data } = await supabase
    .from("sections")
    .select("id, title, config, topic_id, topics(title, subjects(title, courses(title)))")
    .eq("type", "live_class")
    .eq("is_published", true);

  // Standalone scheduled live classes (RLS returns only published ones).
  const { data: liveData } = await supabase
    .from("live_sessions")
    .select("id, title, description, audience, starts_at, join_url, recording_url");
  const standalone = (liveData ?? []).map((s) => {
    const when = s.starts_at ? new Date(s.starts_at) : null;
    return {
      id: s.id,
      title: s.title as string,
      topicId: "",
      course: (s.audience as string) || "Live class",
      subject: "",
      topic: (s.description as string) || "",
      when: when && !isNaN(when.getTime()) ? when : null,
      join: (s.join_url as string) || "",
      recording: (s.recording_url as string) || "",
    };
  });

  const all = [...shape((data ?? []) as unknown as LiveRow[]), ...standalone];
  const now = Date.now();
  const upcoming = all
    .filter((x) => !x.when || x.when.getTime() >= now - 2 * 3600 * 1000)
    .sort((a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity));
  const past = all
    .filter((x) => x.when && x.when.getTime() < now - 2 * 3600 * 1000)
    .sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <div className="learn-hero">
        <span className="badge">📡 Live classes</span>
        <h1>Live classes</h1>
        <p className="meta">Join live sessions with CA Parveen Sharma &amp; team — and catch recordings after. 🎥</p>
      </div>

      <h2 className="admin-section-title">🟢 Upcoming</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {upcoming.length > 0 ? (
          upcoming.map((x) => (
            <div className="list-row" key={x.id}>
              <div>
                <span className="row-title">📡 {x.title}</span>
                <p className="row-sub">
                  {[x.course, x.subject, x.topic].filter(Boolean).join(" · ")} · 🗓️ {whenLabel(x.when)}
                </p>
              </div>
              <div className="row-actions">
                {x.join ? (
                  <a className="btn small" href={x.join} target="_blank" rel="noopener noreferrer">
                    Join →
                  </a>
                ) : x.topicId ? (
                  <Link className="btn small secondary" href={`/learn/topic/${x.topicId}`}>
                    Open topic
                  </Link>
                ) : (
                  <span className="muted" style={{ fontSize: ".82rem" }}>Join link coming soon</span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No upcoming live classes right now — check back soon. ✨</p>
          </div>
        )}
      </div>

      {past.length > 0 && (
        <>
          <h2 className="admin-section-title">⏪ Past (recordings)</h2>
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {past.map((x) => (
              <div className="list-row" key={x.id}>
                <div>
                  <span className="row-title">🎥 {x.title}</span>
                  <p className="row-sub">
                    {x.course} · {x.topic} · {whenLabel(x.when)}
                  </p>
                </div>
                <div className="row-actions">
                  {x.recording ? (
                    <a className="btn small secondary" href={x.recording} target="_blank" rel="noopener noreferrer">
                      ▶️ Watch recording
                    </a>
                  ) : x.topicId ? (
                    <Link className="btn small secondary" href={`/learn/topic/${x.topicId}`}>
                      Open topic
                    </Link>
                  ) : (
                    <span className="muted" style={{ fontSize: ".82rem" }}>Recording soon</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
