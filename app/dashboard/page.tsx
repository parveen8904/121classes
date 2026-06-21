import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPassword from "./set-password";
import MyCourses from "./MyCourses";
import FacultyContacts from "./FacultyContacts";
import { announcementKindLabel } from "@/lib/announcements";
import WellnessTip from "@/app/components/WellnessTip";
import TodayPlan from "@/app/components/TodayPlan";
import { addMyCourse } from "@/app/learn/mycourses";

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

  // Faculty contacts — only the faculty teaching the subjects this student has
  // opted for (their own subjects, plus all subjects of the courses on their
  // shelf), not the whole faculty roster.
  const { data: mySubjectRows } = await supabase
    .from("my_subjects")
    .select("subject_id")
    .eq("student_id", user.id);
  const optedSubjectIds = new Set((mySubjectRows ?? []).map((r) => r.subject_id as string));
  if (myIds.size > 0) {
    const { data: courseSubjects } = await supabase
      .from("subjects")
      .select("id")
      .in("course_id", [...myIds]);
    (courseSubjects ?? []).forEach((s) => optedSubjectIds.add(s.id as string));
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

        <div style={{ marginTop: 20 }}>
          <SetPassword />
        </div>

        <TodayPlan />

        <WellnessTip />

        {/* Three quick actions — same size, neutral (uncoloured) cards with emojis. */}
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            marginTop: 18,
          }}
        >
          {[
            {
              href: "/amendments",
              emoji: "📜",
              title: "Know your amendments and updates",
              desc: "The latest amendments and updates for your exams.",
            },
            {
              href: "/career",
              emoji: "🎓",
              title: "Get placements for articleship and job",
              desc: "Openings and help for articleship and jobs.",
            },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="card"
              style={{ display: "flex", flexDirection: "column", height: "100%" }}
            >
              <span style={{ fontSize: "1.8rem", lineHeight: 1 }}>{a.emoji}</span>
              <strong style={{ display: "block", marginTop: 8, fontSize: ".98rem" }}>{a.title}</strong>
              <span className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>{a.desc}</span>
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
                  style={{ borderColor: a.kind === "amendment" ? "var(--accent)" : "var(--border)" }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span className="badge">{announcementKindLabel(a.kind)}</span>
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

        <FacultyContacts faculty={faculty ?? []} />

        <MyCourses courses={myCourses.map((c) => ({ id: c.id, title: c.title }))} />

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
