import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../../_components/DeleteButton";
import AdminHero from "../../_components/AdminHero";
import SectionForm from "./SectionForm";
import TopicMetaForm, { type TopicMeta } from "./TopicMetaForm";
import { SECTION_TYPES } from "./sectionTypes";
import { createSection, updateSection, deleteSection, toggleSectionPublish, updateTopicMeta } from "./actions";

const TYPE_LABEL = Object.fromEntries(SECTION_TYPES.map((t) => [t.value, t.label]));
const PLAN_LABEL: Record<string, string> = { bronze: "Bronze+", silver: "Silver+", gold: "Gold" };

export default async function TopicDetail({ params }: { params: { topicId: string } }) {
  const supabase = createClient();
  const { topicId } = params;

  const { data: topic } = await supabase
    .from("topics")
    .select(
      "id, title, subject_id, is_published, is_combined, weightage_marks, valid_from_attempt, valid_to_attempt, amendments_upto, important_qs_rev1, important_qs_rev2, book_pdf_url, icai_material_url, revision_video_url, revision_notes_hand_url, revision_notes_typed_url, update_coming, update_on, update_for, update_note, revision_paper_url, amendments_pdf_url, subjects(title)",
    )
    .eq("id", topicId)
    .single();

  if (!topic) notFound();

  const { data: sections } = await supabase
    .from("sections")
    .select("id, type, title, order_index, min_plan, config, is_published")
    .eq("topic_id", topicId)
    .order("order_index")
    .order("title");

  const subjectTitle = (topic as { subjects?: { title?: string } | null }).subjects?.title;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge={topic.is_published ? "🟢 Published topic" : "⚪ Draft topic"}
        title={`📖 ${topic.title}`}
        subtitle="Add the sections students will see — videos, PDFs, homework, discussion and tests. 🎬📑"
        back={{ href: `/admin/subjects/${topic.subject_id}`, label: subjectTitle ?? "Subject" }}
      />

      {/* Topic details — weightage, applicability, important questions, materials */}
      <details style={{ marginTop: 16 }} open={!topic.weightage_marks}>
        <summary className="btn small secondary as-btn">
          📋 Topic details {topic.is_combined ? "(combined topic)" : ""} — weightage, important questions, materials
        </summary>
        <TopicMetaForm action={updateTopicMeta} topic={topic as unknown as TopicMeta} />
      </details>

      {/* Add a class — right-aligned expander (primary action) */}
      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">🎓 Add a class</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 0, marginBottom: 10 }}>
            A class = lecture video + notes PDF + its own discussion. Add as many classes as the topic needs.
          </p>
          <SectionForm
            action={createSection}
            topicId={topic.id}
            submitLabel="Add class"
            defaultType="full_class_video"
          />
        </div>
      </details>

      <details style={{ marginTop: 10 }}>
        <summary className="btn small secondary as-btn">➕ Add another section type (notes, test, homework…)</summary>
        <div className="form-card" style={{ marginTop: 10 }}>
          <SectionForm action={createSection} topicId={topic.id} submitLabel="Add section" />
        </div>
      </details>

      <h2 className="admin-section-title">🎓 Classes &amp; sections</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>
        These render in order for students. Expand one to edit it.
      </p>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {sections && sections.length > 0 ? (
          sections.map((s) => (
            <div className="card" key={s.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong>{s.title}</strong>
                  <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                    {TYPE_LABEL[s.type] ?? s.type} · {s.min_plan ? PLAN_LABEL[s.min_plan] ?? s.min_plan : "Free"} ·
                    order {s.order_index} · {s.is_published ? "published" : "draft"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {s.type === "mcq_test" && (
                    <Link className="btn small secondary" href={`/admin/mcq/${s.id}`}>
                      Manage MCQs →
                    </Link>
                  )}
                  {s.type === "subjective_test" && (
                    <Link className="btn small secondary" href={`/admin/subjective/${s.id}`}>
                      Manage questions →
                    </Link>
                  )}
                  <form action={toggleSectionPublish} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="topicId" value={topic.id} />
                    <input type="hidden" name="next" value={s.is_published ? "false" : "true"} />
                    <button className="btn small secondary" type="submit">
                      {s.is_published ? "Unpublish" : "Publish"}
                    </button>
                  </form>
                  <DeleteButton
                    action={deleteSection}
                    id={s.id}
                    parentId={topic.id}
                    message="Delete this section?"
                  />
                </div>
              </div>

              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: ".9rem" }}>
                  Edit section
                </summary>
                <div style={{ marginTop: 14 }}>
                  <SectionForm
                    action={updateSection}
                    topicId={topic.id}
                    section={{
                      id: s.id,
                      type: s.type,
                      title: s.title,
                      order_index: s.order_index,
                      min_plan: s.min_plan,
                      config: s.config as Record<string, unknown> | null,
                      is_published: s.is_published,
                    }}
                    submitLabel="Save section"
                  />
                </div>
              </details>
            </div>
          ))
        ) : (
          <p className="muted">No sections yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
