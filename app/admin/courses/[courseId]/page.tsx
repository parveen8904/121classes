import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../../_components/DeleteButton";
import AdminHero from "../../_components/AdminHero";
import { updateCourse } from "../actions";
import { createSubject, deleteSubject } from "./actions";

export default async function CourseDetail({ params }: { params: { courseId: string } }) {
  const supabase = createClient();
  const { courseId } = params;

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, slug, order_index, is_published, is_test_series")
    .eq("id", courseId)
    .single();

  if (!course) notFound();

  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, title, slug, order_index")
    .eq("course_id", courseId)
    .order("order_index")
    .order("title");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge={course.is_published ? "🟢 Published course" : "⚪ Draft course"}
        title={`📘 ${course.title}`}
        subtitle="Edit the course details, then add the subjects that sit inside it."
        back={{ href: "/admin/courses", label: "Courses" }}
      />

      {/* New subject — right-aligned expander (primary action) */}
      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ New subject</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <h3>➕ Add a subject</h3>
          <form action={createSubject}>
            <input type="hidden" name="courseId" value={course.id} />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr 0.7fr" }}>
              <div>
                <label htmlFor="s-title">Title</label>
                <input id="s-title" name="title" placeholder="e.g. Accounting" required />
              </div>
              <div>
                <label htmlFor="s-slug">Slug (optional)</label>
                <input id="s-slug" name="slug" placeholder="auto from title" />
              </div>
              <div>
                <label htmlFor="s-order">Order</label>
                <input id="s-order" name="order_index" type="number" defaultValue={0} />
              </div>
            </div>
            <button className="btn" type="submit">
              Add subject
            </button>
          </form>
        </div>
      </details>

      {/* Edit course details — collapsed */}
      <details style={{ marginTop: 10 }}>
        <summary className="btn small secondary as-btn">✏️ Edit course details</summary>
        <div className="form-card" style={{ marginTop: 10 }}>
          <form action={updateCourse}>
            <input type="hidden" name="id" value={course.id} />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr 0.7fr" }}>
              <div>
                <label htmlFor="e-title">Title</label>
                <input id="e-title" name="title" defaultValue={course.title} required />
              </div>
              <div>
                <label htmlFor="e-slug">Slug</label>
                <input id="e-slug" name="slug" defaultValue={course.slug ?? ""} />
              </div>
              <div>
                <label htmlFor="e-order">Order</label>
                <input id="e-order" name="order_index" type="number" defaultValue={course.order_index} />
              </div>
            </div>
            <label className="remember" style={{ marginTop: 0 }}>
              <input type="checkbox" name="is_published" defaultChecked={course.is_published} /> Published
            </label>
            <label className="remember" style={{ marginTop: 0 }}>
              <input type="checkbox" name="is_test_series" defaultChecked={course.is_test_series} /> This is a Test Series
            </label>
            <button className="btn small" type="submit">
              Save changes
            </button>
          </form>
        </div>
      </details>

      <h2 className="admin-section-title">📂 Subjects</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>
        Each subject is led by one or more faculty and holds topics. Click a subject to manage topics.
      </p>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {subjects && subjects.length > 0 ? (
          subjects.map((s) => (
            <div className="list-row" key={s.id}>
              <div>
                <Link href={`/admin/subjects/${s.id}`} className="row-title">
                  📂 {s.title}
                </Link>
                <p className="row-sub">/{s.slug ?? "—"} · order {s.order_index}</p>
              </div>
              <div className="row-actions">
                <Link className="btn small secondary" href={`/admin/subjects/${s.id}`}>
                  Manage →
                </Link>
                <DeleteButton
                  action={deleteSubject}
                  id={s.id}
                  parentId={course.id}
                  message="Delete this subject and all its topics and sections?"
                />
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No subjects yet — add the first one above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
