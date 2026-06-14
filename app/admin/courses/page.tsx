import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import PublishToggle from "../_components/PublishToggle";
import AdminHero from "../_components/AdminHero";
import { createCourse, updateCourse, deleteCourse, toggleCoursePublish } from "./actions";

export default async function CoursesPage() {
  const supabase = createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, order_index, is_published, is_test_series")
    .order("order_index")
    .order("title");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📘 Courses"
        title="Manage courses"
        subtitle="A course holds subjects → topics → classes. Open a course to manage its subjects. 🗂️"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* New course — right-aligned button that expands a form */}
      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ New course</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <h3>➕ Add a course</h3>
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
            <label className="remember" style={{ marginTop: 0 }}>
              <input type="checkbox" name="is_test_series" /> This is a Test Series
            </label>
            <button className="btn" type="submit">
              Add course
            </button>
          </form>
        </div>
      </details>

      <h2 className="admin-section-title">📚 Your courses</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {courses && courses.length > 0 ? (
          courses.map((c) => (
            <div key={c.id}>
              <div className="list-row">
                <div>
                  <Link href={`/admin/courses/${c.id}`} className="row-title">
                    📘 {c.title}
                  </Link>
                  <p className="row-sub">
                    /{c.slug ?? "—"} · order {c.order_index} ·{" "}
                    {c.is_published ? "🟢 published" : "⚪ draft"}
                    {c.is_test_series ? " · 📝 test series" : ""}
                  </p>
                </div>
                <div className="row-actions">
                  <Link className="btn small" href={`/admin/courses/${c.id}`}>
                    Manage →
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

              <details style={{ marginTop: 6 }}>
                <summary className="btn small secondary as-btn">✏️ Edit course details</summary>
                <div className="form-card" style={{ marginTop: 8 }}>
                  <form action={updateCourse}>
                    <input type="hidden" name="id" value={c.id} />
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr 0.7fr" }}>
                      <div>
                        <label>Title</label>
                        <input name="title" defaultValue={c.title} required />
                      </div>
                      <div>
                        <label>Slug</label>
                        <input name="slug" defaultValue={c.slug ?? ""} />
                      </div>
                      <div>
                        <label>Order</label>
                        <input name="order_index" type="number" defaultValue={c.order_index} />
                      </div>
                    </div>
                    <label className="remember" style={{ marginTop: 0 }}>
                      <input type="checkbox" name="is_published" defaultChecked={c.is_published} /> Published
                    </label>
                    <label className="remember" style={{ marginTop: 0 }}>
                      <input type="checkbox" name="is_test_series" defaultChecked={c.is_test_series} /> Test Series
                    </label>
                    <button className="btn small" type="submit">
                      Save changes
                    </button>
                  </form>
                </div>
              </details>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No courses yet — tap ＋ New course above. ✨</p>
          </div>
        )}
      </div>
    </section>
  );
}
