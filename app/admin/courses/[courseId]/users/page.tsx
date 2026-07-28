import Link from "next/link";
import AdminHero from "../../../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Registered users — Admin" };

// Who has actually paid for this course, what they hold, and how much of it
// they have watched. Free trials and lapsed access are excluded: the question
// this page answers is "who are my students on this course, and are they
// getting through it?"

type Row = {
  student: string;
  email: string;
  phone: string;
  plan: string;
  subject: string;
  status: string;
  ends: string | null;
  classesWatched: number;
  classesTotal: number;
  minutesWatched: number;
};

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default async function CourseUsersPage(props: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await props.params;
  const svc = createServiceClient();

  const [{ data: course }, { data: subjects }, { data: subs }] = await Promise.all([
    svc.from("courses").select("id, title").eq("id", courseId).maybeSingle(),
    svc.from("subjects").select("id, title").eq("course_id", courseId),
    svc
      .from("subscriptions")
      .select("student_id, subject_id, status, ends_at, channel, created_at, plans(tier), subjects(title), profiles(full_name, email, phone)")
      .eq("course_id", courseId)
      .in("status", ["active", "blocked"])
      .order("created_at", { ascending: false }),
  ]);

  const subjectIds = (subjects ?? []).map((s) => s.id as string);

  // How many classes the course has, and how much each student has watched.
  const { data: sectionRows } = subjectIds.length
    ? await svc.from("sections_meta").select("id, topic_id").eq("type", "full_class_video").eq("is_published", true)
    : { data: [] };
  const { data: topicRows } = subjectIds.length
    ? await svc.from("topics").select("id, subject_id").in("subject_id", subjectIds)
    : { data: [] };
  const topicSubject = new Map((topicRows ?? []).map((t) => [t.id as string, t.subject_id as string]));
  const courseSectionIds = new Set(
    (sectionRows ?? [])
      .filter((s) => topicSubject.has(s.topic_id as string))
      .map((s) => s.id as string),
  );

  const studentIds = [...new Set((subs ?? []).map((s) => s.student_id as string))];
  const watched = new Map<string, { classes: Set<string>; seconds: number }>();
  if (studentIds.length) {
    const { data: watchRows } = await svc
      .from("class_watch")
      .select("student_id, section_id, video_seconds")
      .in("student_id", studentIds);
    for (const w of watchRows ?? []) {
      if (!courseSectionIds.has(w.section_id as string)) continue;
      const key = w.student_id as string;
      const cur = watched.get(key) ?? { classes: new Set<string>(), seconds: 0 };
      cur.classes.add(w.section_id as string);
      cur.seconds += Number(w.video_seconds ?? 0);
      watched.set(key, cur);
    }
  }

  const rows: Row[] = (subs ?? []).map((s) => {
    const prof = (s as { profiles?: { full_name?: string; email?: string; phone?: string } | null }).profiles;
    const w = watched.get(s.student_id as string);
    return {
      student: prof?.full_name || "—",
      email: prof?.email || "—",
      phone: prof?.phone || "—",
      plan: ((s as { plans?: { tier?: string } | null }).plans?.tier ?? "—") as string,
      subject: ((s as { subjects?: { title?: string } | null }).subjects?.title ?? "Whole course") as string,
      status: s.status as string,
      ends: (s.ends_at as string) ?? null,
      classesWatched: w?.classes.size ?? 0,
      classesTotal: courseSectionIds.size,
      minutesWatched: Math.round((w?.seconds ?? 0) / 60),
    };
  });

  const active = rows.filter((r) => r.status === "active");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1000 }}>
      <AdminHero
        badge="👥 Registered users"
        title={course?.title ? `${course.title} — registered users` : "Registered users"}
        subtitle="Everyone holding paid access to this course, the plan they hold, and how far through the classes they are. 📈"
        back={{ href: `/admin/courses/${courseId}`, label: "Course" }}
      />

      <div className="card" style={{ marginTop: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div><div className="muted" style={{ fontSize: ".76rem" }}>Paid students</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{active.length}</div></div>
        <div><div className="muted" style={{ fontSize: ".76rem" }}>Classes in the course</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{courseSectionIds.size}</div></div>
        <div>
          <div className="muted" style={{ fontSize: ".76rem" }}>Never opened a class</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{active.filter((r) => r.classesWatched === 0).length}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: ".76rem" }}>Blocked</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{rows.filter((r) => r.status === "blocked").length}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted" style={{ margin: 0 }}>Nobody holds paid access to this course yet.</p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "6px 8px" }}>Student</th>
                <th style={{ padding: "6px 8px" }}>Contact</th>
                <th style={{ padding: "6px 8px" }}>Subject</th>
                <th style={{ padding: "6px 8px" }}>Plan</th>
                <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Access until</th>
                <th style={{ padding: "6px 8px", minWidth: 170 }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pct = r.classesTotal ? Math.round((r.classesWatched / r.classesTotal) * 100) : 0;
                return (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)", opacity: r.status === "blocked" ? 0.55 : 1 }}>
                    <td style={{ padding: "7px 8px", fontWeight: 600 }}>
                      {r.student}{r.status === "blocked" ? " 🚫" : ""}
                    </td>
                    <td style={{ padding: "7px 8px", fontSize: ".78rem" }}>
                      {r.email}<br />{r.phone}
                    </td>
                    <td style={{ padding: "7px 8px" }}>{r.subject}</td>
                    <td style={{ padding: "7px 8px", textTransform: "capitalize", fontWeight: 600 }}>{r.plan}</td>
                    <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{fmtDate(r.ends)}</td>
                    <td style={{ padding: "7px 8px" }}>
                      <div style={{ height: 8, borderRadius: 5, background: "var(--bg-soft)", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: pct === 0 ? "var(--bad)" : "var(--accent)" }} />
                      </div>
                      <span className="muted" style={{ fontSize: ".74rem" }}>
                        {r.classesWatched} of {r.classesTotal} classes · {r.minutesWatched} min
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 12 }}>
        Progress counts a class as watched once the student has opened it; the minutes are their actual viewing time.
        Someone at 0 of {courseSectionIds.size} has paid and never started — the most useful call to make.{" "}
        <Link href="/admin/enrolment">Manage access →</Link>
      </p>
    </section>
  );
}
