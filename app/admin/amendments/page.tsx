import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import AmendmentForm, { type AmendmentRow } from "./AmendmentForm";
import { createAmendment, updateAmendment, deleteAmendment } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminAmendmentsPage() {
  const supabase = createClient();
  const [{ data: courses }, { data: subjects }, { data: topics }, { data: amendments }] = await Promise.all([
    supabase.from("courses").select("id, title").order("order_index").order("title"),
    supabase.from("subjects").select("id, title, course_id").order("title"),
    supabase.from("topics").select("id, title, subject_id").order("title"),
    supabase.from("amendments").select("*").order("order_index").order("created_at", { ascending: false }),
  ]);
  const courseList = courses ?? [];
  const subjectList = (subjects ?? []) as { id: string; title: string; course_id: string }[];
  const topicList = (topics ?? []) as { id: string; title: string; subject_id: string }[];
  const subjName = new Map(subjectList.map((s) => [s.id, s.title]));
  const topicName = new Map(topicList.map((t) => [t.id, t.title]));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📜 Amendments & updates"
        title="Amendments & updates"
        subtitle="Post amendments and updates by course/subject/topic, with a video, notes and the attempts they apply to. 📝"
        back={{ href: "/admin", label: "Admin" }}
      />

      <details style={{ marginTop: 18 }}>
        <summary className="btn as-btn">＋ New amendment / update</summary>
        <div className="form-card" style={{ marginTop: 12 }}>
          <h3>➕ Add an amendment / update</h3>
          <AmendmentForm action={createAmendment} courses={courseList} subjects={subjectList} topics={topicList} submitLabel="Add amendment" />
        </div>
      </details>

      <h2 className="admin-section-title">📋 Amendments ({(amendments ?? []).length})</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {amendments && amendments.length > 0 ? (
          (amendments as AmendmentRow[]).map((a) => (
            <details className="card" key={a.id}>
              <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong>{a.title}</strong>
                <span className="muted" style={{ fontSize: ".8rem" }}>
                  {a.valid_from_attempt ? `📅 ${a.valid_from_attempt}${a.valid_to_attempt ? `–${a.valid_to_attempt}` : " onwards"}` : "no attempt set"}
                  {a.topic_id ? ` · ${topicName.get(a.topic_id) ?? "topic"}` : a.subject_id ? ` · ${subjName.get(a.subject_id) ?? "subject"}` : ""}
                  {a.is_published ? " · 🟢 published" : " · ⚪ draft"}
                </span>
              </summary>
              <div style={{ marginTop: 12 }}>
                <AmendmentForm action={updateAmendment} courses={courseList} subjects={subjectList} topics={topicList} amendment={a} submitLabel="Save changes" />
                <div style={{ marginTop: 10 }}>
                  <DeleteButton action={deleteAmendment} id={a.id} message="Delete this amendment?" />
                </div>
              </div>
            </details>
          ))
        ) : (
          <p className="muted">No amendments yet — add the first one above.</p>
        )}
      </div>
    </section>
  );
}
