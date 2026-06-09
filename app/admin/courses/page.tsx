import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import PublishToggle from "../_components/PublishToggle";
import { createCourse, deleteCourse, toggleCoursePublish } from "./actions";

export default async function CoursesPage() {
  const supabase = createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, order_index, is_published")
    .order("order_index")
    .order("title");

  return (
    <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <p className="muted" style={{ marginBottom: 8 }}>
        <Link className="muted" href="/admin">
          ← Admin
        </Link>
      </p>
      <h1 style={{ marginBottom: 6 }}>Courses</h1>
      <p className="muted">A course holds subjects → topics → sections. Click a course to manage it.</p>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 14 }}>Add a course</h3>
        <form action={createCourse}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr 0.7fr" }}>
            <div>
              <label htmlFor="c-title">Title</label>
              <input id="c-title" name="title" placeholder="e.g. CA Intermediate" required />
            </div>
            <div>
              <label htmlFor="c-slug">Slug (optional)</label>
              <input id="c-slug" name="slug" placeholder="auto from title" />
            </div>
            <div>
              <label htmlFor="c-order">Order</label>
              <input id="c-order" name="order_index" type="number" defaultValue={0} />
            </div>
          </div>
          <label className="remember" style={{ marginTop: 0 }}>
            <input type="checkbox" name="is_published" /> Published (visible to students)
          </label>
          <button className="btn" type="submit">
            Add course
          </button>
        </form>
      </div>

      <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
        {courses && courses.length > 0 ? (
          courses.map((c) => (
            <div
              className="card"
              key={c.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
              <div>
                <Link href={`/admin/courses/${c.id}`} style={{ fontWeight: 700 }}>
                  {c.title}
                </Link>
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                  /{c.slug ?? "—"} · order {c.order_index} ·{" "}
                  {c.is_published ? "published" : "draft"}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Link className="btn small secondary" href={`/admin/courses/${c.id}`}>
                  Manage
                </Link>
                <PublishToggle action={toggleCoursePublish} id={c.id} published={c.is_published} />
                <DeleteButton
                  action={deleteCourse}
                  id={c.id}
                  label="Delete"
                  message="Delete this course and ALL its subjects, topics and sections?"
                />
              </div>
            </div>
          ))
        ) : (
          <p className="muted">No courses yet. Add your first one above.</p>
        )}
      </div>
    </section>
  );
}
