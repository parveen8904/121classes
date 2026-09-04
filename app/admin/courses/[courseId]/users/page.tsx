import { formatDate } from "@/lib/dates";
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
  v ? formatDate(v) : "—";

// A PAGE AT A TIME. His ask, 4 September 2026: "pages with a large amount of
// data take more time to load because everything is being loaded on a single
// page ... Registered Users in Course can become very lengthy."
//
// It was reading every subscription on the course — 2,637 of them on FR — then
// every watch row for every one of those students, then printing all of it into
// one HTML document. Three costs, each paid in full before the first row
// appeared.
//
// Now: the table is one page of a hundred, the watch data is fetched only for
// the hundred on it, and the four headline figures are counted in the database
// rather than by loading rows in order to length them.
const PER_PAGE = 100;

export default async function CourseUsersPage(props: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { courseId } = await props.params;
  const page = Math.max(1, Math.round(Number((await props.searchParams).p) || 1));
  const svc = createServiceClient();

  const [{ data: course }, { data: subjects }] = await Promise.all([
    svc.from("courses").select("id, title").eq("id", courseId).maybeSingle(),
    svc.from("subjects").select("id, title").eq("course_id", courseId),
  ]);

  // THE COUNT THAT NEVER SHOWED, for two stacked reasons.
  //
  // First, `profiles(...)` with no path: subscriptions carries TWO foreign
  // keys into profiles (student_id and granted_by_admin_id), so PostgREST
  // refused the embed as ambiguous — and with it the WHOLE query. The page
  // rendered politely around a null: zero students, blank list. "The total
  // number of registered users is still not showing."
  //
  // Second, even valid, one request stops silently at a thousand rows and
  // there are 2,637 active subscriptions. So it is read a page at a time.
  type SubRow = {
    student_id: string; subject_id: string | null; status: string; ends_at: string | null;
    channel: string | null; created_at: string;
    plans: { tier?: string } | null; subjects: { title?: string } | null;
    profiles: { full_name?: string; email?: string; phone?: string } | null;
  };
  // THE HEADLINES ARE COUNTED, NOT LENGTHED.
  //
  // These were `rows.filter(...).length` over every subscription on the course,
  // which is the only reason all of them had to be in memory at all. Postgres
  // can count without sending anything back.
  const [{ count: activeCount }, { count: blockedCount }, { count: totalCount }] = await Promise.all([
    svc.from("subscriptions").select("id", { count: "exact", head: true })
      .eq("course_id", courseId).eq("status", "active"),
    svc.from("subscriptions").select("id", { count: "exact", head: true })
      .eq("course_id", courseId).eq("status", "blocked"),
    svc.from("subscriptions").select("id", { count: "exact", head: true })
      .eq("course_id", courseId).in("status", ["active", "blocked"]),
  ]);

  const total = totalCount ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(page, pages);
  const from = (current - 1) * PER_PAGE;

  const { data: pageRows } = await svc
    .from("subscriptions")
    .select("student_id, subject_id, status, ends_at, channel, created_at, plans(tier), subjects(title), profiles:student_id(full_name, email, phone)")
    .eq("course_id", courseId)
    .in("status", ["active", "blocked"])
    .order("created_at", { ascending: false })
    .range(from, from + PER_PAGE - 1);
  const subs = (pageRows ?? []) as unknown as SubRow[];

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

  const studentIds = [...new Set(subs.map((s) => s.student_id))];
  const watched = new Map<string, { classes: Set<string>; seconds: number }>();
  if (studentIds.length) {
    // In chunks: 2,000+ UUIDs in one .in() builds a URL the server refuses,
    // and it comes back as an empty column rather than an error.
    const { inChunks } = await import("@/lib/pageAll");
    // Batches of 50: each response is still capped at 1,000 rows, and fifty
    // heavy watchers stay under it where two hundred would not.
    const watchRows = await inChunks(studentIds, (batch) =>
      svc.from("class_watch")
        .select("student_id, section_id, video_seconds")
        .in("student_id", batch), 50);
    for (const w of watchRows ?? []) {
      if (!courseSectionIds.has(w.section_id as string)) continue;
      const key = w.student_id as string;
      const cur = watched.get(key) ?? { classes: new Set<string>(), seconds: 0 };
      cur.classes.add(w.section_id as string);
      cur.seconds += Number(w.video_seconds ?? 0);
      watched.set(key, cur);
    }
  }

  const rows: Row[] = subs.map((s) => {
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

  // WHO HAS NEVER OPENED A CLASS — asked across the whole course, not this page.
  //
  // "Someone at 0 of N has paid and never started" is the most useful call on
  // this screen, so it must not quietly become "0 of N on page 3". It is the
  // one figure that cannot be a plain count, so it is the difference between
  // the students who hold access and the students who appear even once against
  // a class of this course.
  let neverOpened = activeCount ?? 0;
  if (courseSectionIds.size) {
    const watchers = new Set<string>();
    const secIds = [...courseSectionIds];
    const { inChunks } = await import("@/lib/pageAll");
    const rowsSeen = await inChunks(secIds, (batch) =>
      svc.from("class_watch").select("student_id").in("section_id", batch), 200);
    for (const w of rowsSeen ?? []) watchers.add(String((w as { student_id: string }).student_id));
    neverOpened = Math.max(0, (activeCount ?? 0) - watchers.size);
  }

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
        <div><div className="muted" style={{ fontSize: ".76rem" }}>Paid students</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{activeCount ?? 0}</div></div>
        <div><div className="muted" style={{ fontSize: ".76rem" }}>Classes in the course</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{courseSectionIds.size}</div></div>
        <div>
          <div className="muted" style={{ fontSize: ".76rem" }}>Never opened a class</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{neverOpened}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: ".76rem" }}>Blocked</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{blockedCount ?? 0}</div>
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

      {/* THE PAGER. Shown only when there is more than one page, so a small
          course still reads as one list with nothing to click. */}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          {current > 1 && (
            <Link className="btn small secondary" href={`/admin/courses/${courseId}/users?p=${current - 1}`}>← Previous</Link>
          )}
          <span className="muted" style={{ fontSize: ".8rem" }}>
            Showing {from + 1}–{Math.min(from + PER_PAGE, total)} of {total} · page {current} of {pages}
          </span>
          {current < pages && (
            <Link className="btn small secondary" href={`/admin/courses/${courseId}/users?p=${current + 1}`}>Next →</Link>
          )}
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
