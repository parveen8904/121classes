import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import PublishToggle from "../_components/PublishToggle";
import AdminHero from "../_components/AdminHero";
import { createCourse, deleteCourse, toggleCoursePublish } from "./actions";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const supabase = createClient();
  const q = (searchParams.q ?? "").trim();
  const status = searchParams.status ?? "";

  let query = supabase
    .from("courses")
    .select("id, title, slug, order_index, is_published")
    .order("order_index")
    .order("title");
  if (q) query = query.or(`title.ilike.%${q}%,slug.ilike.%${q}%`);
  if (status === "published") query = query.eq("is_published", true);
  if (status === "draft") query = query.eq("is_published", false);

  const { data: courses } = await query;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📘 Courses"
        title="Courses"
        subtitle="A course holds subjects → topics → sections. Click a course to manage it. 🗂️"
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="form-card" style={{ marginTop: 24 }}>
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

      <form style={{ marginTop: 24, display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr auto", alignItems: "end" }}>
        <div>
          <label htmlFor="q">Search courses</label>
          <input id="q" name="q" defaultValue={q} placeholder="Title or slug…" style={{ marginBottom: 0 }} />
        </div>
        <div>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} style={{ marginBottom: 0 }}>
            <option value="">All</option>
            <option value="published">🟢 Published</option>
            <option value="draft">⚪ Draft</option>
          </select>
        </div>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>

      <h2 className="admin-section-title">
        📚 All courses
        {(q || status) && (
          <Link className="muted" href="/admin/courses" style={{ fontSize: ".8rem", fontWeight: 400 }}>
            clear
          </Link>
        )}
      </h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {courses && courses.length > 0 ? (
          courses.map((c) => (
            <div className="list-row" key={c.id}>
              <div>
                <Link href={`/admin/courses/${c.id}`} className="row-title">
                  📘 {c.title}
                </Link>
                <p className="row-sub">
                  /{c.slug ?? "—"} · order {c.order_index} ·{" "}
                  {c.is_published ? "🟢 published" : "⚪ draft"}
                </p>
              </div>
              <div className="row-actions">
                <Link className="btn small secondary" href={`/admin/courses/${c.id}`}>
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
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No courses yet — add your first one above. ✨</p>
          </div>
        )}
      </div>
    </section>
  );
}
