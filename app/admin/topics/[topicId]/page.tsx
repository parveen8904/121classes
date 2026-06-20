import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../../_components/DeleteButton";
import AdminHero from "../../_components/AdminHero";
import SectionForm from "./SectionForm";
import TopicMetaForm, { type TopicMeta } from "./TopicMetaForm";
import { SECTION_TYPES } from "./sectionTypes";
import { createSection, updateSection, deleteSection, toggleSectionPublish, updateTopicMeta, summarizeClassSection, convertHandwrittenNotes, approveTypedNotes, rejectTypedNotes, addTopicMaterial, deleteTopicMaterial } from "./actions";
import PdfUpload from "../../_components/PdfUpload";

const TYPE_LABEL = Object.fromEntries(SECTION_TYPES.map((t) => [t.value, t.label]));
const PLAN_LABEL: Record<string, string> = { bronze: "Bronze+", silver: "Silver+", gold: "Gold" };

export default async function TopicDetail({ params }: { params: { topicId: string } }) {
  const supabase = createClient();
  const { topicId } = params;

  const { data: topic } = await supabase
    .from("topics")
    .select(
      "id, title, subject_id, is_published, is_combined, topic_code, weightage_marks, importance, valid_from_attempt, valid_to_attempt, amendments_upto, important_qs_rev1, important_qs_rev2, book_pdf_url, icai_material_url, revision_video_url, revision_notes_hand_url, revision_notes_typed_url, update_coming, update_on, update_for, update_note, revision_paper_url, amendments_pdf_url, subjects(title)",
    )
    .eq("id", topicId)
    .single();

  if (!topic) notFound();

  // AI-training material attached to this topic (PDFs whose text is extracted).
  const { data: materials } = await supabase
    .from("repository_items")
    .select("id, title, kind, file_url, content")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false });

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

      {/* Topic materials — ONE upload that students download AND the AI learns from */}
      <details style={{ marginTop: 12 }}>
          <summary className="btn small secondary as-btn">
            📚 Topic materials — question bank / ICAI / RTP / past papers / book ({materials?.length ?? 0})
          </summary>
          <div className="form-card" style={{ marginTop: 10 }}>
            <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
              Upload once — each PDF is <strong>shown to students to download</strong> AND its text is read so the <strong>AI is trained</strong> on it for this topic (doubts, MCQs &amp; descriptive questions, alongside the class transcripts &amp; your important questions). No need to upload anywhere else.
            </p>
            <form action={addTopicMaterial}>
              <input type="hidden" name="topicId" value={topic.id} />
              <input type="hidden" name="subjectId" value={topic.subject_id} />
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label>Type</label>
                  <select name="kind" defaultValue="question_bank">
                    <option value="question_bank">📚 Question bank</option>
                    <option value="icai">🏛️ ICAI material</option>
                    <option value="rtp">📄 RTP</option>
                    <option value="past_papers">🗂️ Past exam questions</option>
                    <option value="book">📕 Book</option>
                    <option value="notes">📝 Notes</option>
                  </select>
                </div>
                <div>
                  <label>Name</label>
                  <input name="title" placeholder="e.g. AS-13 Question Bank" />
                </div>
              </div>
              <PdfUpload name="file_url" folder="repository" label="PDF (text is auto-extracted for the AI)" />
              <label style={{ marginTop: 6 }}>Or paste text directly</label>
              <textarea name="content" rows={3} placeholder="Optional — paste text instead of (or in addition to) a PDF." />
              <button className="btn small" type="submit" style={{ marginTop: 8 }}>Add training material</button>
            </form>
            {materials && materials.length > 0 && (
              <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                {materials.map((mt) => (
                  <div key={mt.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "6px 10px", background: "var(--bg-soft)", borderRadius: 8 }}>
                    <span style={{ minWidth: 0, fontSize: ".85rem" }}>
                      <strong>{mt.title}</strong> <span className="muted">· {mt.kind} · {(mt.content as string | null) ? `${Math.round(String(mt.content).length / 1000)}k chars read ✓` : "⚠️ no text extracted"}</span>
                    </span>
                    <DeleteButton action={deleteTopicMaterial} id={mt.id} parentId={topic.id} message="Remove this training material?" />
                  </div>
                ))}
              </div>
            )}
          </div>
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
                  {s.type === "full_class_video" && !!(s.config as Record<string, unknown> | null)?.transcript && (
                    <form action={summarizeClassSection} style={{ display: "inline" }}>
                      <input type="hidden" name="sectionId" value={s.id} />
                      <input type="hidden" name="topicId" value={topic.id} />
                      <button className="btn small secondary" type="submit">🤖 Class summary (from transcript)</button>
                    </form>
                  )}
                  {!!(s.config as Record<string, unknown> | null)?.notes_hand_url && !((s.config as Record<string, unknown>)?.notes_typed_status) && (
                    <form action={convertHandwrittenNotes} style={{ display: "inline" }}>
                      <input type="hidden" name="sectionId" value={s.id} />
                      <input type="hidden" name="topicId" value={topic.id} />
                      <button className="btn small secondary" type="submit">✍️→⌨️ Convert notes (AI)</button>
                    </form>
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

              {(() => {
                const cfg = (s.config as Record<string, unknown> | null) ?? {};
                const status = cfg.notes_typed_status as string | undefined;
                if (status === "pending") {
                  return (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "#fef3c7", borderRadius: 8, fontSize: ".88rem" }}>
                      <strong>⏳ Typed notes awaiting faculty approval</strong>
                      <p style={{ margin: "4px 0 8px", whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{String(cfg.notes_typed_pending ?? "")}</p>
                      <a className="btn small secondary" href={`/learn/notes/${s.id}/pdf`} target="_blank" rel="noopener noreferrer" style={{ marginBottom: 8, display: "inline-block" }}>
                        ⬇️ Download as PDF to review
                      </a>
                      <div style={{ display: "flex", gap: 8 }}>
                        <form action={approveTypedNotes}>
                          <input type="hidden" name="sectionId" value={s.id} />
                          <input type="hidden" name="topicId" value={topic.id} />
                          <button className="btn small" type="submit">✅ Approve &amp; publish</button>
                        </form>
                        <form action={rejectTypedNotes}>
                          <input type="hidden" name="sectionId" value={s.id} />
                          <input type="hidden" name="topicId" value={topic.id} />
                          <button className="btn small secondary" type="submit">✕ Reject</button>
                        </form>
                      </div>
                    </div>
                  );
                }
                if (status === "approved") {
                  return <p className="muted" style={{ marginTop: 10, fontSize: ".82rem", color: "#16a34a" }}>✅ Typed notes approved &amp; live for students.</p>;
                }
                return null;
              })()}

              {(() => {
                const cfg = (s.config as Record<string, unknown> | null) ?? {};
                if (!cfg.ai_summary) return null;
                return (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-soft)", borderRadius: 8, fontSize: ".88rem" }}>
                    <strong>🤖 Class summary (from your transcript — shown to students)</strong>
                    <p style={{ margin: "4px 0 6px" }}>{String(cfg.ai_summary)}</p>
                    {cfg.ai_concepts_discussed ? (
                      <p className="muted" style={{ margin: "2px 0", fontSize: ".82rem" }}>🔑 Concepts discussed: {String(cfg.ai_concepts_discussed).split("\n").filter(Boolean).join(" · ")}</p>
                    ) : null}
                    {cfg.ai_questions_discussed ? (
                      <p className="muted" style={{ margin: "2px 0", fontSize: ".82rem" }}>❓ Questions discussed: {String(cfg.ai_questions_discussed).split("\n").filter(Boolean).join(" · ")}</p>
                    ) : null}
                    <p className="muted" style={{ margin: "2px 0", fontSize: ".82rem" }}>
                      📝 {Number(cfg.ai_homework_count) || 0} homework questions solved in class
                      {cfg.ai_homework_next ? ` · 📚 Homework for next class: ${String(cfg.ai_homework_next)}` : ""}
                    </p>
                  </div>
                );
              })()}

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
