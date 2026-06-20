import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../../_components/DeleteButton";
import AdminHero from "../../_components/AdminHero";
import { fmtMins } from "../../_lib/util";
import SubmitButton from "@/app/components/SubmitButton";
import {
  createTopic,
  deleteTopic,
  toggleTopicPublish,
  updateSubjectInline,
  setSubjectFaculty,
} from "./actions";

export default async function SubjectDetail({ params }: { params: { subjectId: string } }) {
  const supabase = createClient();
  const { subjectId } = params;

  const { data: subject } = await supabase
    .from("subjects")
    .select("id, title, slug, code, order_index, course_id, gold_price_inr, validity_months, telegram_group_url, courses(title)")
    .eq("id", subjectId)
    .single();

  if (!subject) notFound();

  const [{ data: topics }, { data: faculties }, { data: assigned }] = await Promise.all([
    supabase
      .from("topics")
      .select("id, title, slug, order_index, valid_from_attempt, valid_to_attempt, amendments_upto, important_qs_rev1, important_qs_rev2, is_published, is_combined")
      .eq("subject_id", subjectId)
      .order("is_combined")
      .order("order_index")
      .order("title"),
    supabase.from("faculties").select("id, full_name").order("full_name"),
    supabase.from("subject_faculty").select("faculty_id").eq("subject_id", subjectId),
  ]);

  const assignedIds = new Set((assigned ?? []).map((a) => a.faculty_id));
  const courseTitle = (subject as { courses?: { title?: string } | null }).courses?.title;

  // Aggregate every section in the subject: per-topic class counts/durations +
  // class-number ranges, and subject-wide totals (classes, revisions, tests).
  const topicIds = (topics ?? []).map((t) => t.id);
  const classCount = new Map<string, number>();
  const classMins = new Map<string, number>();
  const classNoMin = new Map<string, number>();
  const classNoMax = new Map<string, number>();
  let totalClasses = 0, totalClassMins = 0, revisionCount = 0, revisionMins = 0, mcqCount = 0, descCount = 0;
  const materialKinds = new Set<string>();

  if (topicIds.length) {
    const { data: secRows } = await supabase
      .from("sections")
      .select("topic_id, type, config")
      .in("topic_id", topicIds)
      .eq("is_published", true);
    for (const r of secRows ?? []) {
      const tid = (r as { topic_id: string }).topic_id;
      const type = (r as { type: string }).type;
      const cfg = (r as { config?: { duration_minutes?: unknown; class_no?: unknown } }).config ?? {};
      const d = Number(cfg.duration_minutes) || 0;
      if (type === "full_class_video") {
        totalClasses++; totalClassMins += d;
        classCount.set(tid, (classCount.get(tid) ?? 0) + 1);
        classMins.set(tid, (classMins.get(tid) ?? 0) + d);
        const no = parseInt(String(cfg.class_no ?? "").replace(/\D/g, ""), 10);
        if (Number.isFinite(no) && no > 0) {
          classNoMin.set(tid, Math.min(classNoMin.get(tid) ?? Infinity, no));
          classNoMax.set(tid, Math.max(classNoMax.get(tid) ?? 0, no));
        }
      } else if (type === "revision_video") {
        revisionCount++; revisionMins += d;
      } else if (type === "mcq_test") {
        mcqCount++;
      } else if (type === "subjective_test") {
        descCount++;
      }
    }

    // Materials available in the subject (books / RTP / past papers / ICAI …) —
    // transcripts are intentionally excluded (never shared with students).
    const { data: matRows } = await supabase
      .from("repository_items")
      .select("kind")
      .in("topic_id", topicIds)
      .eq("is_active", true)
      .not("file_url", "is", null);
    for (const r of matRows ?? []) {
      const k = (r as { kind: string }).kind;
      if (k && k !== "transcript") materialKinds.add(k);
    }
  }

  // Subject-level rollups for the summary banner.
  const hasRev1 = (topics ?? []).some((t) => ((t as { important_qs_rev1?: string | null }).important_qs_rev1 ?? "").trim());
  const hasRev2 = (topics ?? []).some((t) => ((t as { important_qs_rev2?: string | null }).important_qs_rev2 ?? "").trim());
  const attempts = [...new Set((topics ?? []).map((t) => t.valid_from_attempt).filter(Boolean) as string[])];
  const MAT_LABEL: Record<string, string> = { book: "📕 Books", question_bank: "📚 Question bank", icai: "🏛️ ICAI", rtp: "📄 RTP", mtp: "📄 MTP", past_papers: "🗂️ Past papers", notes: "📝 Notes" };
  const materialList = [...materialKinds].map((k) => MAT_LABEL[k] ?? k);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📂 Subject"
        title={subject.title}
        subtitle={`Part of ${courseTitle ?? "this course"} · manage its topics below. 📖`}
        back={{ href: `/admin/courses/${subject.course_id}`, label: courseTitle ?? "Course" }}
      />

      {/* Subject summary banner — the same overview a student sees */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 10px" }}>📊 Subject summary — {subject.title}</h3>
        <div style={{ display: "grid", gap: 7, fontSize: ".92rem" }}>
          <div>🎓 <strong>{totalClasses}</strong> {totalClasses === 1 ? "class" : "classes"} · ⏱️ <strong>{fmtMins(totalClassMins)}</strong> total class time</div>
          <div>🎬 <strong>{revisionCount}</strong> revision {revisionCount === 1 ? "video" : "videos"} · ⏱️ <strong>{fmtMins(revisionMins)}</strong> total revision time</div>
          <div>🧠 <strong>{mcqCount}</strong> MCQ {mcqCount === 1 ? "test" : "tests"} · ✍️ <strong>{descCount}</strong> descriptive {descCount === 1 ? "test" : "tests"}</div>
          <div>📌 Most important questions — first revision: <strong>{hasRev1 ? "✓ available" : "— not added"}</strong> · second revision: <strong>{hasRev2 ? "✓ available" : "— not added"}</strong></div>
          <div>📚 Materials: <strong>{materialList.length ? materialList.join(" · ") : "none uploaded yet"}</strong></div>
          <div>📅 Applicable attempt(s): <strong>{attempts.length ? attempts.join(", ") : "all attempts"}</strong></div>
        </div>
        <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0 0" }}>
          Students see this same summary (transcripts are never shown to them).
        </p>
      </div>

      {/* New topic — right-aligned expander (primary action) */}
      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ New topic</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <h3>➕ Add a topic</h3>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: -4, marginBottom: 10 }}>
            Optionally set the exam attempt a topic applies <strong>from</strong> — it keeps applying to
            every later attempt. Leave blank to show it to everyone.
          </p>
          <form action={createTopic}>
            <input type="hidden" name="subjectId" value={subject.id} />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr 0.7fr" }}>
              <div>
                <label htmlFor="t-title">Title</label>
                <input id="t-title" name="title" placeholder="e.g. AS 24 – Discontinuing Operations" required />
              </div>
              <div>
                <label htmlFor="t-slug">Slug (optional)</label>
                <input id="t-slug" name="slug" placeholder="auto from title" />
              </div>
              <div>
                <label htmlFor="t-order">Order</label>
                <input id="t-order" name="order_index" type="number" defaultValue={0} />
              </div>
            </div>
            <div style={{ maxWidth: 320 }}>
              <label htmlFor="t-from">Applies from attempt (optional)</label>
              <input id="t-from" name="valid_from_attempt" placeholder="e.g. MAY_2026 — blank = all attempts" />
            </div>
            <label className="remember" style={{ marginTop: 0 }}>
              <input type="checkbox" name="is_published" /> Published
            </label>
            <SubmitButton className="btn" savedLabel="✓ Added" closeDetails>
              Add topic
            </SubmitButton>
          </form>
        </div>
      </details>

      {/* Subject settings & faculty — tucked away */}
      <details style={{ marginTop: 10 }}>
        <summary className="btn small secondary as-btn">⚙️ Subject settings &amp; faculty</summary>

        <div className="form-card" style={{ marginTop: 10 }}>
          <h3>✏️ Edit subject</h3>
          <form action={updateSubjectInline}>
            <input type="hidden" name="id" value={subject.id} />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 0.8fr 1fr 0.7fr" }}>
              <div>
                <label htmlFor="su-title">Title</label>
                <input id="su-title" name="title" defaultValue={subject.title} required />
              </div>
              <div>
                <label htmlFor="su-code">Code (2 letters)</label>
                <input id="su-code" name="code" defaultValue={(subject as { code?: string }).code ?? ""} maxLength={4} placeholder="e.g. AA" style={{ textTransform: "uppercase" }} />
              </div>
              <div>
                <label htmlFor="su-slug">Slug</label>
                <input id="su-slug" name="slug" defaultValue={subject.slug ?? ""} />
              </div>
              <div>
                <label htmlFor="su-order">Order</label>
                <input id="su-order" name="order_index" type="number" defaultValue={subject.order_index} />
              </div>
            </div>
            <p className="muted" style={{ fontSize: ".8rem", margin: "2px 0 8px" }}>
              The 2-letter code (e.g. <strong>AA</strong> for Advanced Accounting) starts every class&apos;s auto-generated unique number.
            </p>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
              <div>
                <label htmlFor="su-gold">🥇 Gold price (₹) — blank if sold only in a combo</label>
                <input
                  id="su-gold"
                  name="gold_price_inr"
                  type="number"
                  min={0}
                  placeholder="e.g. 9900"
                  defaultValue={subject.gold_price_inr ?? ""}
                />
              </div>
              <div>
                <label htmlFor="su-validity">Access validity (months)</label>
                <input
                  id="su-validity"
                  name="validity_months"
                  type="number"
                  min={1}
                  defaultValue={subject.validity_months ?? 12}
                />
              </div>
            </div>
            <div style={{ marginTop: 4 }}>
              <label htmlFor="su-tg">✈️ Telegram group link (this subject only)</label>
              <input id="su-tg" name="telegram_group_url" defaultValue={(subject as { telegram_group_url?: string }).telegram_group_url ?? ""} placeholder="https://t.me/+… — shown only to students who added this subject" />
            </div>
            <p className="muted" style={{ fontSize: ".82rem", marginBottom: 12 }}>
              Bronze is free. Silver is a flat price on the <Link href="/admin/plans">Plans page</Link>. Gold
              is the per-subject price above. The Telegram group is offered only to students who have this
              subject in their courses.
            </p>
            <SubmitButton className="btn">
              Save subject
            </SubmitButton>
          </form>
        </div>

        <div className="form-card" style={{ marginTop: 10 }}>
          <h3>👩‍🏫 Faculty for this subject</h3>
          {faculties && faculties.length > 0 ? (
            <form action={setSubjectFaculty}>
              <input type="hidden" name="subjectId" value={subject.id} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, margin: "10px 0 14px" }}>
                {faculties.map((f) => (
                  <label key={f.id} className="remember" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      name="faculty_id"
                      value={f.id}
                      defaultChecked={assignedIds.has(f.id)}
                    />{" "}
                    {f.full_name}
                  </label>
                ))}
              </div>
              <SubmitButton className="btn">
                Save faculty
              </SubmitButton>
            </form>
          ) : (
            <p className="muted" style={{ fontSize: ".9rem" }}>
              No faculty yet. Add some on the <Link href="/admin/faculty">Faculty page</Link>, then assign them here.
            </p>
          )}
        </div>
      </details>

      {/* Topics */}
      <h2 className="admin-section-title">📖 Topics</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {topics && topics.length > 0 ? (
          topics.map((t, i) => {
            const cMin = classNoMin.get(t.id);
            const cMax = classNoMax.get(t.id);
            const range = cMin && cMax ? (cMin === cMax ? `Class ${cMin}` : `Classes ${cMin}–${cMax}`) : null;
            return (
            <div className="list-row" key={t.id}>
              <div>
                <Link href={`/admin/topics/${t.id}`} className="row-title">
                  📖 Topic {i + 1}: {t.title}
                </Link>
                <p className="row-sub">
                  {range ? <><strong>{range}</strong> · </> : null}
                  order {t.order_index} · {t.is_published ? "🟢 published" : "⚪ draft"}
                  {t.valid_from_attempt ? ` · from ${t.valid_from_attempt}` : ""}
                </p>
              </div>
              <div className="row-actions">
                <span style={{ fontWeight: 700, fontSize: ".95rem", background: "var(--bg-soft)", padding: "6px 12px", borderRadius: 8, whiteSpace: "nowrap" }}>
                  🎓 {classCount.get(t.id) ?? 0} {(classCount.get(t.id) ?? 0) === 1 ? "class" : "classes"} · ⏱️ {fmtMins(classMins.get(t.id) ?? 0)}
                </span>
                <Link className="btn small" href={`/admin/topics/${t.id}`}>
                  Classes →
                </Link>
                <form action={toggleTopicPublish} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="subjectId" value={subject.id} />
                  <input type="hidden" name="next" value={t.is_published ? "false" : "true"} />
                  <SubmitButton className="btn small secondary">
                    {t.is_published ? "Unpublish" : "Publish"}
                  </SubmitButton>
                </form>
                <DeleteButton
                  action={deleteTopic}
                  id={t.id}
                  parentId={subject.id}
                  message="Delete this topic and all its sections?"
                />
              </div>
            </div>
            );
          })
        ) : (
          <div className="card">
            <p className="muted">📭 No topics yet — tap ＋ New topic above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
