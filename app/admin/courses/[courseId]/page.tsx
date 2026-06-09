import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../../_components/DeleteButton";
import { updateCourse } from "../actions";
import { createSubject, deleteSubject } from "./actions";

export default async function CourseDetail({ params }: { params: { courseId: string } }) {
  const supabase = createClient();
  const { courseId } = params;

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, slug, order_index, is_published")
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
    <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <p className="muted" style={{ marginBottom: 8 }}>
        <Link className="muted" href="/admin/courses">
          ← Courses
        </Link>
      </p>
      <h1 style={{ marginBottom: 6 }}>{course.title}</h1>
      <p className="muted">{course.is_published ? "Published" : "Draft"}</p>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 14 }}>Edit course</h3>
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
          <button className="btn" type="submit">
            Save changes
          </button>
        </form>
      </div>

      <h2 style={{ margin: "36px 0 6px", fontSize: "1.2rem" }}>Subjects</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>
        Each subject is led by one or more faculty and holds topics. Click a subject to manage topics.
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 14 }}>Add a subject</h3>
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

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {subjects && subjects.length > 0 ? (
          subjects.map((s) => (
            <div
              className="card"
              key={s.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
              <div>
                <Link href={`/admin/subjects/${s.id}`} style={{ fontWeight: 700 }}>
                  {s.title}
                </Link>
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                  /{s.slug ?? "—"} · order {s.order_index}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Link className="btn small secondary" href={`/admin/subjects/${s.id}`}>
                  Manage
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
          <p className="muted">No subjects yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
