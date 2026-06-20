import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPassword from "./set-password";
import ConnectChannels from "./ConnectChannels";
import WellnessTip from "@/app/components/WellnessTip";
import TodayPlan from "@/app/components/TodayPlan";
import { addMyCourse, removeMyCourse } from "@/app/learn/mycourses";

export default async function Dashboard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, target_attempt, telegram_chat_id")
    .eq("id", user.id)
    .single();

  const { data: chSettings } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["support_telegram", "support_whatsapp"]);
  const chMap = new Map((chSettings ?? []).map((r) => [r.key, r.value as string]));

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title")
    .eq("is_published", true)
    .order("order_index");

  const { data: myCourseRows } = await supabase
    .from("my_courses")
    .select("course_id")
    .eq("student_id", user.id);
  const myIds = new Set((myCourseRows ?? []).map((r) => r.course_id as string));
  const myCourses = (courses ?? []).filter((c) => myIds.has(c.id));
  const otherCourses = (courses ?? []).filter((c) => !myIds.has(c.id));

  // Faculty messages / updates — shown to every student on login.
  const { data: announcements } = await supabase
    .from("announcements")
    .select("id, kind, title, body, link_url, published_at")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(5);

  return (
    <main>

      <section className="container" style={{ paddingTop: 40 }}>
        <span className="badge">🎓 Student dashboard</span>
        <h1 style={{ margin: "14px 0 6px" }}>
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""} 👋
        </h1>
        <p className="muted">
          {user.email ?? user.phone} · 🎯 Target attempt:{" "}
          {profile?.target_attempt ?? "not set"}
        </p>

        <div style={{ marginTop: 20 }}>
          <SetPassword />
        </div>

        <ConnectChannels
          telegramChannel={chMap.get("support_telegram")}
          whatsapp={chMap.get("support_whatsapp")}
          alreadyLinked={!!profile?.telegram_chat_id}
        />

        <TodayPlan />

        <WellnessTip />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <Link className="btn small secondary" href="/planner">🗓️ Study planner</Link>
          <Link className="btn small secondary" href="/amendments">📜 Know your amendments</Link>
          <Link className="btn small secondary" href="/career">🎓 Career corner</Link>
        </div>

        {announcements && announcements.length > 0 && (
          <>
            <h2 style={{ margin: "32px 0 12px", fontSize: "1.2rem" }}>📣 From CA Parveen Sharma</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {announcements.map((a) => (
                <div
                  key={a.id}
                  className="card"
                  style={{ borderColor: a.kind === "amendment" ? "var(--accent)" : "var(--border)" }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span className="badge">{a.kind === "amendment" ? "Amendment" : "Update"}</span>
                    <strong>{a.title}</strong>
                  </div>
                  {a.body && <p className="muted" style={{ fontSize: ".9rem", marginTop: 6 }}>{a.body}</p>}
                  {a.link_url && (
                    <a href={a.link_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".88rem" }}>
                      Read more →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, margin: "32px 0 16px" }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem" }}>📚 My courses</h2>
        </div>

        {myCourses.length > 0 ? (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
            {myCourses.map((c) => (
              <div key={c.id} className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <Link href={`/learn/${c.id}`} style={{ display: "block" }}>
                  <h3>📘 {c.title}</h3>
                  <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
                    Open course → subjects, topics &amp; classes →
                  </p>
                </Link>
                <form action={removeMyCourse} style={{ marginTop: "auto", paddingTop: 12 }}>
                  <input type="hidden" name="course_id" value={c.id} />
                  <button className="btn small secondary" type="submit">✕ Remove from my courses</button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              📭 You haven&apos;t added any courses yet. Pick one below to add it to your courses.
            </p>
          </div>
        )}

        {otherCourses.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary className="btn small">＋ Add a course</summary>
            <div className="card" style={{ marginTop: 10 }}>
              <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
                Add the courses you&apos;re studying. You can remove any of them anytime.
              </p>
              <div style={{ display: "grid", gap: 8 }}>
                {otherCourses.map((c) => (
                  <form key={c.id} action={addMyCourse} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 8 }}>
                    <input type="hidden" name="course_id" value={c.id} />
                    <span style={{ fontWeight: 600 }}>📘 {c.title}</span>
                    <button className="btn small" type="submit">＋ Add</button>
                  </form>
                ))}
              </div>
            </div>
          </details>
        )}
      </section>
    </main>
  );
}
