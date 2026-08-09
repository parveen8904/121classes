import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";

export const dynamic = "force-dynamic";
export const metadata = { title: "The hitlist — CA Parveen Sharma" };

// THE HITLIST — the questions that must be done, chapter by chapter.
//
// This list has existed all along. It was typed into the admin against each
// subject, it feeds the study planner, and CA Parveen Sharma names it in class.
// But no page ever showed it to a student, so when two of them wrote in asking
// "can you share pdf for hitlist" there was no link to give and nothing to send.
//
// It is not a file. It is a list of question numbers per chapter, and the point
// of it is to be read next to the question bank — so it is a page, not a PDF.

type TopicList = {
  id: string;
  title: string;
  subject_id: string;
  important_qs_rev1: string | null;
  important_qs_rev2: string | null;
};

type Uploaded = {
  id: string;
  subject_id: string;
  title: string;
  file_url: string | null;
  valid_from_attempt: string | null;
};

type Subject = {
  id: string;
  title: string;
  course_id: string;
  miq_rev1: string | null;
  miq_rev2: string | null;
};

/** "AS 2 – 1, 2, 3, 4, 8" → a heading and its questions. */
function asRows(raw: string): { chapter: string; qs: string }[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // The dash between chapter and questions is typed as – or -, and some
      // lines carry no dash at all. Splitting on the FIRST one keeps chapter
      // names that themselves contain a dash (Ind AS 32 / 107 / 109).
      const m = /^(.*?)\s*[–—-]\s*(.*)$/.exec(line);
      return m ? { chapter: m[1], qs: m[2] } : { chapter: line, qs: "" };
    });
}

function List({ title, raw }: { title: string; raw: string }) {
  const rows = asRows(raw);
  return (
    <div style={{ marginTop: 18 }}>
      <strong style={{ fontSize: ".95rem" }}>{title}</strong>
      <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              flexWrap: "wrap",
              background: i % 2 ? "var(--bg-soft)" : "transparent",
              borderRadius: 6,
              padding: "5px 9px",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: ".88rem", minWidth: 190 }}>{r.chapter}</span>
            <span style={{ fontSize: ".88rem", letterSpacing: ".01em" }}>{r.qs}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function HitlistPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/learn/hitlist");

  const svc = createServiceClient();

  // Only the subjects this student actually has. The list is one of the most
  // valuable things here — it is the shortcut through a 500-question bank.
  const { data: mine } = await supabase.from("my_subjects").select("subject_id");
  const ids = (mine ?? []).map((r) => String((r as { subject_id: string }).subject_id));

  const { data: subjRows } = ids.length
    ? await svc
        .from("subjects")
        .select("id, title, course_id, miq_rev1, miq_rev2")
        .in("id", ids)
        .order("order_index")
    : { data: [] as Subject[] };

  const subjects = (subjRows ?? []) as Subject[];

  // The list lives in two places: consolidated against the subject, and chapter
  // by chapter against each topic. The course page already promises the
  // per-topic ones exist, so a page that ignored them would call a subject
  // empty while the course page said "available".
  const { data: topicRows } = ids.length
    ? await svc
        .from("topics")
        .select("id, title, subject_id, important_qs_rev1, important_qs_rev2, order_index")
        .in("subject_id", ids)
        .eq("is_published", true)
        .order("order_index")
    : { data: [] as TopicList[] };
  const perTopic = new Map<string, TopicList[]>();
  for (const t of (topicRows ?? []) as TopicList[]) {
    if (!(t.important_qs_rev1 ?? "").trim() && !(t.important_qs_rev2 ?? "").trim()) continue;
    const arr = perTopic.get(t.subject_id) ?? [];
    arr.push(t);
    perTopic.set(t.subject_id, arr);
  }

  // An UPLOADED hitlist wins over the typed lists.
  //
  // The typed most-important-question lists carry no attempt, and they are the
  // older ones; the current list is uploaded as a PDF and tagged with the exam
  // it is for ("Hitlist for Sep'26 Exam"). Showing both without saying which is
  // current would have a student revising last year's questions.
  const { data: uploaded } = ids.length
    ? await svc
        .from("repository_items")
        .select("id, subject_id, title, file_url, valid_from_attempt")
        .in("subject_id", ids)
        .eq("kind", "custom")
        .eq("is_active", true)
        .eq("student_visible", true)
        .or("title.ilike.%hitlist%,title.ilike.%hit list%")
        .order("created_at", { ascending: false })
    : { data: [] as Uploaded[] };
  const pdfFor = new Map<string, Uploaded[]>();
  for (const u of (uploaded ?? []) as Uploaded[]) {
    if (!u.file_url) continue;
    const arr = pdfFor.get(u.subject_id) ?? [];
    arr.push(u);
    pdfFor.set(u.subject_id, arr);
  }

  const hasAnything = (s: Subject) =>
    Boolean(
      pdfFor.get(s.id)?.length ||
      (s.miq_rev1 ?? "").trim() ||
      (s.miq_rev2 ?? "").trim() ||
      perTopic.get(s.id)?.length,
    );
  const withList = subjects.filter(hasAnything);
  const without = subjects.filter((s) => !hasAnything(s));

  const courseIds = [...new Set(subjects.map((s) => s.course_id))];
  const { data: courseRows } = courseIds.length
    ? await svc.from("courses").select("id, title").in("id", courseIds)
    : { data: [] as { id: string; title: string }[] };
  const courseName = new Map((courseRows ?? []).map((c) => [c.id as string, c.title as string]));

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 820 }}>
        <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <span className="badge">🎯 The hitlist</span>
        <h1 style={{ margin: "12px 0 6px" }}>The questions that must be done</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          Chapter by chapter, the question numbers to do first — from the question bank for that
          subject. Do these before anything else, and do the second-revision list when you come
          back to the chapter.
        </p>

        {subjects.length === 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <p style={{ margin: 0 }}>
              You have no subjects yet. <Link href="/pricing">See the plans</Link> to get started.
            </p>
          </div>
        )}

        {withList.map((s) => (
          <div className="card" key={s.id} style={{ marginTop: 18 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "1.05rem" }}>{s.title}</strong>
              <span className="badge">{courseName.get(s.course_id) ?? ""}</span>
            </div>
            {(pdfFor.get(s.id) ?? []).map((u) => (
              <a
                key={u.id}
                href={viaProxy(u.file_url)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", gap: 12, alignItems: "center", marginTop: 14,
                  border: "2px solid var(--accent)", borderRadius: 12,
                  background: "var(--bg-soft)", padding: "12px 14px", color: "var(--text)",
                }}
              >
                <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>📄</span>
                <span style={{ flex: 1 }}>
                  <strong style={{ fontSize: ".95rem" }}>{u.title}</strong>
                  {u.valid_from_attempt && (
                    <span className="muted" style={{ display: "block", fontSize: ".8rem" }}>
                      For the {u.valid_from_attempt} exam
                    </span>
                  )}
                </span>
                <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".85rem" }}>Open →</span>
              </a>
            ))}

            {/* The typed lists carry no attempt and are the earlier ones, so
                they only stand in where nothing has been uploaded. */}
            {!(pdfFor.get(s.id) ?? []).length && (s.miq_rev1 ?? "").trim() && <List title="First revision" raw={s.miq_rev1!} />}
            {!(pdfFor.get(s.id) ?? []).length && (s.miq_rev2 ?? "").trim() && <List title="Second revision" raw={s.miq_rev2!} />}

            {/* Only shown when the subject has no consolidated list — otherwise
                the same question numbers would appear twice on one page. */}
            {!(pdfFor.get(s.id) ?? []).length && !(s.miq_rev1 ?? "").trim() && !(s.miq_rev2 ?? "").trim() &&
              (perTopic.get(s.id) ?? []).map((t) => (
                <div key={t.id} style={{ marginTop: 14 }}>
                  <strong style={{ fontSize: ".92rem" }}>{t.title}</strong>
                  {(t.important_qs_rev1 ?? "").trim() && <List title="First revision" raw={t.important_qs_rev1!} />}
                  {(t.important_qs_rev2 ?? "").trim() && <List title="Second revision" raw={t.important_qs_rev2!} />}
                </div>
              ))}
          </div>
        ))}

        {/* Said plainly rather than left blank — a student who does not see their
            subject here should know it is not ready, not that they missed it. */}
        {without.length > 0 && (
          <p className="muted" style={{ marginTop: 20, fontSize: ".88rem", lineHeight: 1.7 }}>
            Not out yet for {without.map((s) => s.title).join(", ")}. It is written after the
            classes for a subject are complete, so it follows the batch.
          </p>
        )}
      </section>
    </main>
  );
}
