import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPassword from "./set-password";
import ConnectTelegram from "./ConnectTelegram";
import MyCourses from "./MyCourses";
import FacultyContacts from "./FacultyContacts";
import { announcementKindLabel } from "@/lib/announcements";
import WellnessTip from "@/app/components/WellnessTip";
import TodayPlan from "@/app/components/TodayPlan";
import { addMyCourse } from "@/app/learn/mycourses";
import OnboardingWizard from "./OnboardingWizard";

export default async function Dashboard({ searchParams }: { searchParams: { saved?: string } }) {
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
  const isAdminUser = profile?.role === "admin";

  // First-visit wizard: ask level → subjects → attempt and write the profile
  // from the answers (instead of bouncing new students to the profile form).
  const needsSetup = !isAdminUser && (myIds.size === 0 || !profile?.target_attempt);
  let subjectsByCourse: Record<string, { id: string; title: string }[]> = {};
  if (needsSetup) {
    const { data: allSubs } = await supabase
      .from("subjects")
      .select("id, title, course_id")
      .in("course_id", (courses ?? []).map((c) => c.id))
      .order("title");
    subjectsByCourse = {};
    for (const s of allSubs ?? []) {
      const k = s.course_id as string;
      (subjectsByCourse[k] ??= []).push({ id: s.id as string, title: s.title as string });
    }
  }

  // Faculty contacts — only the faculty teaching the subjects this student has
  // opted for (their own subjects, plus all subjects of the courses on their
  // shelf), not the whole faculty roster.
  const { data: mySubjectRows } = await supabase
    .from("my_subjects")
    .select("subject_id")
    .eq("student_id", user.id);
  // Scope to the ACTIVE level only — subjects remembered from other levels are
  // ignored here so the dashboard stays single-level.
  const myAllSubjectIds = (mySubjectRows ?? []).map((r) => r.subject_id as string);
  const optedSubjectIds = new Set<string>();
  if (myIds.size > 0) {
    const { data: courseSubjects } = await supabase
      .from("subjects")
      .select("id")
      .in("course_id", [...myIds]);
    const activeCourseSubs = new Set((courseSubjects ?? []).map((s) => s.id as string));
    for (const sid of myAllSubjectIds) if (activeCourseSubs.has(sid)) optedSubjectIds.add(sid);
    if (optedSubjectIds.size === 0) activeCourseSubs.forEach((s) => optedSubjectIds.add(s));
  }

  let faculty: { id: string; full_name: string; phone: string | null; email: string | null; photo_url: string | null }[] = [];
  if (optedSubjectIds.size > 0) {
    const { data: sf } = await supabase
      .from("subject_faculty")
      .select("faculty_id")
      .in("subject_id", [...optedSubjectIds]);
    const facIds = [...new Set((sf ?? []).map((r) => r.faculty_id as string))];
    if (facIds.length > 0) {
      const { data: facs } = await supabase
        .from("faculties")
        .select("id, full_name, phone, email, photo_url")
        .in("id", facIds)
        .order("full_name");
      faculty = facs ?? [];
    }
  }

  // 📡 Live classes TODAY — standalone sessions + topic live-classes in the
  // student's opted subjects, that start today.
  const nowD = new Date();
  const dayStart = new Date(nowD); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(nowD); dayEnd.setHours(23, 59, 59, 999);
  type LiveToday = { title: string; whenISO: string; joinUrl: string | null; where: string | null; href?: string };
  const liveToday: LiveToday[] = [];
  const { data: liveSessions } = await supabase
    .from("live_sessions")
    .select("title, audience, starts_at, join_url, faculties(full_name)")
    .eq("is_published", true)
    .gte("starts_at", dayStart.toISOString())
    .lte("starts_at", dayEnd.toISOString());
  for (const s of liveSessions ?? []) {
    const fac = (s as { faculties?: { full_name?: string } | null }).faculties?.full_name;
    const where = [fac ? `by ${fac}` : null, (s.audience as string) || null].filter(Boolean).join(" · ") || null;
    liveToday.push({ title: s.title as string, whenISO: s.starts_at as string, joinUrl: (s.join_url as string) ?? null, where, href: "/live" });
  }
  if (optedSubjectIds.size > 0) {
    const { data: optTopics } = await supabase.from("topics").select("id, title").in("subject_id", [...optedSubjectIds]);
    const topicTitle = new Map((optTopics ?? []).map((t) => [t.id as string, t.title as string]));
    const tIds = (optTopics ?? []).map((t) => t.id as string);
    if (tIds.length) {
      const { data: liveSecs } = await supabase
        .from("sections")
        .select("id, title, topic_id, config")
        .in("topic_id", tIds)
        .eq("type", "live_class")
        .eq("is_published", true);
      for (const sec of liveSecs ?? []) {
        const cfg = (sec.config ?? {}) as Record<string, string>;
        const sa = cfg.starts_at ? new Date(cfg.starts_at) : null;
        if (sa && sa >= dayStart && sa <= dayEnd) {
          liveToday.push({ title: sec.title as string, whenISO: cfg.starts_at, joinUrl: cfg.join_url ?? null, where: topicTitle.get(sec.topic_id as string) ?? null, href: `/learn/section/${sec.id}` });
        }
      }
    }
  }
  liveToday.sort((a, b) => (a.whenISO < b.whenISO ? -1 : 1));

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

        {searchParams?.saved === "profile" && (
          <div className="notice ok" style={{ marginTop: 14 }}>✅ Profile saved.</div>
        )}

        {liveToday.length > 0 && (
          <div className="card" style={{ marginTop: 16, border: "2px solid #ef4444" }}>
            <strong style={{ fontSize: "1.05rem" }}>📡 Live classes today</strong>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {liveToday.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <strong>{l.title}</strong>
                    <span className="muted" style={{ fontSize: ".82rem" }}>
                      {" · "}🕒 {new Date(l.whenISO).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                      {l.where ? ` · ${l.where}` : ""}
                    </span>
                  </div>
                  {l.joinUrl ? (
                    <a className="btn small" href={l.joinUrl} target="_blank" rel="noopener noreferrer" style={{ background: "#ef4444" }}>▶️ Join live</a>
                  ) : l.href ? (
                    <Link className="btn small secondary" href={l.href}>Open</Link>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <SetPassword />
        </div>

        <ConnectTelegram />

        <TodayPlan />

        <WellnessTip />

        {/* Two bold, colourful quick-action cards (Gen-Z style). */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
            marginTop: 18,
          }}
        >
          {[
            {
              href: "/amendments",
              emoji: "📜",
              title: "Know your amendments & updates",
              desc: "Stay exam-ready with the latest amendments and updates ✨",
              bg: "linear-gradient(135deg,#0d9488,#10b981)",
            },
            {
              href: "/career",
              emoji: "💼",
              title: "Get placements — articleship & job",
              desc: "Live openings + help to land your articleship & job 🚀",
              bg: "linear-gradient(135deg,#0f766e,#0d9488)",
            },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                background: a.bg,
                color: "#fff",
                borderRadius: 18,
                padding: "20px 22px",
                textDecoration: "none",
                boxShadow: "0 8px 22px rgba(13,148,136,.22)",
              }}
            >
              <span style={{ fontSize: "2.2rem", lineHeight: 1 }}>{a.emoji}</span>
              <strong style={{ display: "block", marginTop: 10, fontSize: "1.1rem", color: "#fff" }}>{a.title}</strong>
              <span style={{ fontSize: ".85rem", marginTop: 6, color: "rgba(255,255,255,.92)" }}>{a.desc}</span>
              <span style={{ marginTop: "auto", paddingTop: 12, fontWeight: 800, color: "#fff" }}>Open →</span>
            </Link>
          ))}
        </div>

        {announcements && announcements.length > 0 && (
          <>
            <h2 style={{ margin: "32px 0 12px", fontSize: "1.2rem" }}>📣 From CA Parveen Sharma</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {announcements.map((a) => (
                <div
                  key={a.id}
                  className="card"
                  style={{ border: "1px solid var(--border)", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span className="badge">{announcementKindLabel(a.kind)}</span>
                    <strong>{a.title}</strong>
                  </div>
                  {a.body && (
                    <p className="muted" style={{ fontSize: ".9rem", marginTop: 6, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {a.body}
                    </p>
                  )}
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

        {needsSetup && (
          <OnboardingWizard
            courses={(courses ?? []).map((c) => ({ id: c.id, title: c.title }))}
            subjectsByCourse={subjectsByCourse}
            needAttempt={!profile?.target_attempt}
          />
        )}

        <FacultyContacts faculty={faculty ?? []} />

        <MyCourses courses={myCourses.map((c) => ({ id: c.id, title: c.title }))} />

        <div style={{ marginTop: 12 }}>
          <Link className="btn small secondary" href="/gift">🎁 Gift a subscription to someone</Link>
        </div>

        {!isAdminUser && !needsSetup && myCourses.length > 0 && (
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 12 }}>
            ➕ Want more subjects? Open{" "}
            <Link href={`/learn/${myCourses[0].id}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
              your course
            </Link>{" "}
            and tap &ldquo;Add to my subjects&rdquo; on any subject. Changing your level (e.g. Inter → Final)?{" "}
            <Link href="/dashboard/profile" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Update your profile
            </Link>
            .
          </p>
        )}

        {isAdminUser && otherCourses.length > 0 && (
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
