import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../../_components/DeleteButton";
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
    .select("id, title, slug, order_index, course_id, courses(title)")
    .eq("id", subjectId)
    .single();

  if (!subject) notFound();

  const [{ data: topics }, { data: faculties }, { data: assigned }] = await Promise.all([
    supabase
      .from("topics")
      .select("id, title, slug, order_index, valid_from_attempt, valid_to_attempt, amendments_upto, is_published")
      .eq("subject_id", subjectId)
      .order("order_index")
      .order("title"),
    supabase.from("faculties").select("id, full_name").order("full_name"),
    supabase.from("subject_faculty").select("faculty_id").eq("subject_id", subjectId),
  ]);

  const assignedIds = new Set((assigned ?? []).map((a) => a.faculty_id));
  const courseTitle = (subject as { courses?: { title?: string } | null }).courses?.title;

  return (
    <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <p className="muted" style={{ marginBottom: 8 }}>
        <Link className="muted" href={`/admin/courses/${subject.course_id}`}>
          ← {courseTitle ?? "Course"}
        </Link>
      </p>
      <h1 style={{ marginBottom: 6 }}>{subject.title}</h1>
      <p className="muted">Subject in {courseTitle ?? "this course"}.</p>

      {/* Edit subject */}
      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 14 }}>Edit subject</h3>
        <form action={updateSubjectInline}>
          <input type="hidden" name="id" value={subject.id} />
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr 0.7fr" }}>
            <div>
              <label htmlFor="su-title">Title</label>
              <input id="su-title" name="title" defaultValue={subject.title} required />
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
          <button className="btn" type="submit">
            Save subject
          </button>
        </form>
      </div>

      {/* Faculty assignment */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 6 }}>Faculty for this subject</h3>
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
            <button className="btn" type="submit">
              Save faculty
            </button>
          </form>
        ) : (
          <p className="muted" style={{ fontSize: ".9rem" }}>
            No faculty yet. Add some on the{" "}
            <Link href="/admin/faculty">Faculty page</Link>, then assign them here.
          </p>
        )}
      </div>

      {/* Topics */}
      <h2 style={{ margin: "36px 0 6px", fontSize: "1.2rem" }}>Topics</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>
        Optionally set the exam attempt a topic applies <strong>from</strong> — it then keeps applying
        to every later attempt. Leave it blank to show the topic to everyone.
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 14 }}>Add a topic</h3>
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
          <button className="btn" type="submit">
            Add topic
          </button>
        </form>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {topics && topics.length > 0 ? (
          topics.map((t) => (
            <div
              className="card"
              key={t.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
              <div>
                <Link href={`/admin/topics/${t.id}`} style={{ fontWeight: 700 }}>
                  {t.title}
                </Link>
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                  order {t.order_index} · {t.is_published ? "published" : "draft"}
                  {t.valid_from_attempt ? ` · from ${t.valid_from_attempt}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Link className="btn small secondary" href={`/admin/topics/${t.id}`}>
                  Sections
                </Link>
                <form action={toggleTopicPublish} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="subjectId" value={subject.id} />
                  <input type="hidden" name="next" value={t.is_published ? "false" : "true"} />
                  <button className="btn small secondary" type="submit">
                    {t.is_published ? "Unpublish" : "Publish"}
                  </button>
                </form>
                <DeleteButton
                  action={deleteTopic}
                  id={t.id}
                  parentId={subject.id}
                  message="Delete this topic and all its sections?"
                />
              </div>
            </div>
          ))
        ) : (
          <p className="muted">No topics yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
