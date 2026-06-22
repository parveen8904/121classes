import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../../_components/DeleteButton";
import AdminHero from "../../_components/AdminHero";
import SectionForm from "./SectionForm";
import TopicMetaForm, { type TopicMeta } from "./TopicMetaForm";
import { SECTION_TYPES } from "./sectionTypes";
import { createSection, updateSection, deleteSection, toggleSectionPublish, updateTopicMeta, summarizeClassSection, addTopicMaterial, deleteTopicMaterial, createTopicGroup, renameTopicGroup, deleteTopicGroup, moveTopicGroup, applyStandardSections } from "./actions";
import PdfUpload from "../../_components/PdfUpload";
import SubmitButton from "@/app/components/SubmitButton";
import { fmtMins } from "../../_lib/util";

const TYPE_LABEL = Object.fromEntries(SECTION_TYPES.map((t) => [t.value, t.label]));
const PLAN_LABEL: Record<string, string> = { bronze: "Bronze+", silver: "Silver+", gold: "Gold" };

export default async function TopicDetail({
  params,
  searchParams,
}: {
  params: { topicId: string };
  searchParams?: { summary?: string };
}) {
  const supabase = createClient();
  const { topicId } = params;

  const { data: topic } = await supabase
    .from("topics")
    .select(
      "id, title, subject_id, is_published, is_combined, topic_code, weightage_marks, importance, valid_from_attempt, valid_to_attempt, amendments_upto, application_notes, important_qs_rev1, important_qs_rev2, book_pdf_url, icai_material_url, revision_video_url, revision_notes_hand_url, revision_notes_typed_url, update_coming, update_on, update_for, update_note, revision_paper_url, amendments_pdf_url, subjects(title, code)",
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
    .select("id, type, title, order_index, min_plan, config, is_published, group_id")
    .eq("topic_id", topicId)
    .order("order_index")
    .order("title");

  // "Sections" = named content groups the admin creates inside the topic.
  const { data: groups } = await supabase
    .from("topic_groups")
    .select("id, name, order_index")
    .eq("topic_id", topicId)
    .order("order_index")
    .order("created_at");
  const groupList = groups ?? [];
  const groupName = new Map(groupList.map((g) => [g.id, g.name]));

  const subjectInfo = (topic as { subjects?: { title?: string; code?: string } | null }).subjects;
  const subjectTitle = subjectInfo?.title;
  const subjectCode = subjectInfo?.code ?? "";
  const topicCode = (topic as { topic_code?: string }).topic_code ?? "";

  // Topic totals: number of classes (excluding ≤100-min "part" continuations
  // like 7B) and their combined duration (including the parts).
  const classSections = (sections ?? []).filter((s) => s.type === "full_class_video");
  const mainClassCount = classSections.filter(
    (s) => !/[A-Za-z]/.test(String((s.config as { class_no?: unknown } | null)?.class_no ?? "")),
  ).length;
  const topicMins = classSections.reduce(
    (a, s) => a + (Number((s.config as { duration_minutes?: unknown } | null)?.duration_minutes) || 0),
    0,
  );

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge={topic.is_published ? "🟢 Published topic" : "⚪ Draft topic"}
        title={`📖 ${topic.title}`}
        subtitle="Add the sections students will see — videos, PDFs, homework, discussion and tests. 🎬📑"
        back={{ href: `/admin/subjects/${topic.subject_id}`, label: subjectTitle ?? "Subject" }}
      />

      {searchParams?.summary === "ok" && (
        <div className="notice ok" style={{ marginTop: 16 }}>✅ Class summary generated — see it under the class below.</div>
      )}
      {searchParams?.summary === "exists" && (
        <div className="notice ok" style={{ marginTop: 16 }}>✅ This class already has a saved summary (shown below) — no AI was used.</div>
      )}
      {searchParams?.summary === "empty" && (
        <div className="notice" style={{ marginTop: 16, background: "rgba(234,179,8,0.12)", color: "#fde047" }}>⚠️ That class has no transcript yet (or it&apos;s too short). Add the transcript to the class first, then generate the summary.</div>
      )}
      {searchParams?.summary === "failed" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          ❌ The AI couldn&apos;t generate the summary. This usually means the Anthropic API has no credit balance —
          add credits at <strong>console.anthropic.com → Plans &amp; Billing</strong>, then try again. (The same applies to all AI features.)
        </div>
      )}

      {/* Topic details — weightage, applicability, important questions, materials */}
      <details style={{ marginTop: 16 }}>
        <summary className="btn small secondary as-btn">
          📋 Topic details — short code, weightage, important questions
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
              <SubmitButton className="btn small" savedLabel="✓ Added" style={{ marginTop: 8 }}>Add training material</SubmitButton>
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

      {/* Specific adders — no confusing "section type" picker */}
      {/* SECTIONS = named content groups the admin creates inside the topic. */}
      <h2 className="admin-section-title">📚 Sections</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>
        A <strong>Section</strong> is a named container (e.g. &ldquo;Classes&rdquo;, &ldquo;Revision Round 1&rdquo;, &ldquo;Updates&rdquo;). Create your sections here, then add content (a class, video, PDF or test) into a section below.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {groupList.map((g, i) => (
          <details className="card" key={g.id}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>📚 {g.name}</summary>
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <form action={renameTopicGroup} style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 220 }}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="topicId" value={topic.id} />
                <input name="name" defaultValue={g.name} style={{ flex: 1 }} />
                <SubmitButton className="btn small" savedLabel="✓" closeDetails>Rename</SubmitButton>
              </form>
              <form action={moveTopicGroup} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={g.id} /><input type="hidden" name="topicId" value={topic.id} /><input type="hidden" name="dir" value="up" />
                <button className="btn small secondary" type="submit" disabled={i === 0}>↑</button>
              </form>
              <form action={moveTopicGroup} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={g.id} /><input type="hidden" name="topicId" value={topic.id} /><input type="hidden" name="dir" value="down" />
                <button className="btn small secondary" type="submit" disabled={i === groupList.length - 1}>↓</button>
              </form>
              <DeleteButton action={deleteTopicGroup} id={g.id} parentId={topic.id} message="Delete this section? Its content stays but becomes Unsorted." />
            </div>
          </details>
        ))}
        {groupList.length === 0 && <p className="muted" style={{ fontSize: ".85rem", margin: 0 }}>No sections yet — create your first one below.</p>}
      </div>
      <form action={createTopicGroup} className="form-card" style={{ marginTop: 10 }}>
        <input type="hidden" name="topicId" value={topic.id} />
        <label htmlFor="g-name">New section name</label>
        <p className="muted" style={{ fontSize: ".78rem", margin: "2px 0 6px" }}>📌 Sections are <strong>standard for every topic, subject and course</strong> — adding, renaming or removing one here applies to all topics automatically.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="g-name" name="name" placeholder="e.g. Revision Round 1" required style={{ flex: 1 }} />
          <SubmitButton className="btn" savedLabel="✓ Added everywhere">Add section</SubmitButton>
        </div>
      </form>
      <form action={applyStandardSections} style={{ marginTop: 8 }}>
        <input type="hidden" name="topicId" value={topic.id} />
        <SubmitButton className="btn small secondary" savedLabel="✓ Applied">↻ Re-apply standard sections to all topics</SubmitButton>
      </form>

      <h2 className="admin-section-title">➕ Add content to a section</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>Content is one of four kinds — a <strong>video</strong>, a <strong>PDF</strong>, an <strong>MCQ test</strong> or a <strong>descriptive test</strong>. Pick the Section it goes into in each form.</p>
      <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
        <details>
          <summary className="btn secondary as-btn">🎥 Add a video</summary>
          <div className="form-card" style={{ marginTop: 10 }}>
            <p className="muted" style={{ fontSize: ".85rem", marginTop: 0, marginBottom: 10 }}>Upload the video (+ PDF/notes). Choose its <strong>Kind</strong>: a detailed class is auto-numbered 1, 2, 3…; a Revision Round 1 / 2 video is numbered R1 / R2; a plain video gets no number.</p>
            <SectionForm action={createSection} topicId={topic.id} submitLabel="Add video" defaultType="full_class_video" kindMode subjectCode={subjectCode} topicCode={topicCode} groups={groupList} />
          </div>
        </details>
        <details>
          <summary className="btn secondary as-btn">📄 Add a PDF</summary>
          <div className="form-card" style={{ marginTop: 10 }}>
            <p className="muted" style={{ fontSize: ".85rem", marginTop: 0, marginBottom: 10 }}>Upload a PDF (notes / material) into a Section — no video needed.</p>
            <SectionForm action={createSection} topicId={topic.id} submitLabel="Add PDF" defaultType="pdf" groups={groupList} />
          </div>
        </details>
        <details>
          <summary className="btn secondary as-btn">🧠 Add an MCQ test</summary>
          <div className="form-card" style={{ marginTop: 10 }}>
            <p className="muted" style={{ fontSize: ".85rem", marginTop: 0, marginBottom: 10 }}>Creates the MCQ test and takes you straight to the page to <strong>upload or generate</strong> its questions.</p>
            <SectionForm action={createSection} topicId={topic.id} submitLabel="Add MCQ test" defaultType="mcq_test" groups={groupList} />
          </div>
        </details>
        <details>
          <summary className="btn secondary as-btn">✍️ Add a descriptive test</summary>
          <div className="form-card" style={{ marginTop: 10 }}>
            <p className="muted" style={{ fontSize: ".85rem", marginTop: 0, marginBottom: 10 }}>Creates the descriptive test and takes you straight to the page to upload its questions &amp; solutions.</p>
            <SectionForm action={createSection} topicId={topic.id} submitLabel="Add descriptive test" defaultType="subjective_test" groups={groupList} />
          </div>
        </details>
        <details>
          <summary className="btn secondary as-btn">📡 Add a live class</summary>
          <div className="form-card" style={{ marginTop: 10 }}>
            <p className="muted" style={{ fontSize: ".85rem", marginTop: 0, marginBottom: 10 }}>A live class taken over <strong>Zoom</strong> (join link + start time) and/or <strong>YouTube</strong> (recording link). Pick the Section it goes into.</p>
            <SectionForm action={createSection} topicId={topic.id} submitLabel="Add live class" defaultType="live_class" groups={groupList} />
          </div>
        </details>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h2 className="admin-section-title" style={{ margin: 0 }}>📦 Content in this topic</h2>
        <span style={{ fontWeight: 700, fontSize: ".95rem", background: "var(--bg-soft)", padding: "6px 12px", borderRadius: 8, whiteSpace: "nowrap" }}>
          🎓 {mainClassCount} {mainClassCount === 1 ? "class" : "classes"} · ⏱️ {fmtMins(topicMins)}
        </span>
      </div>
      <p className="muted" style={{ fontSize: ".9rem" }}>
        These are the individual items inside your sections. Tap an item to open its controls, AI summary and the <strong>Edit</strong> form (rename, change its Section, video, PDF, tier…).
      </p>

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        {sections && sections.length > 0 ? (
          sections.map((s) => (
            <details className="card" key={s.id} open={s.type === "subjective_test" || s.type === "mcq_test"}>
              <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                <strong>{s.title}</strong>
                <span className="muted" style={{ fontSize: ".8rem" }}>
                  📚 {(s.group_id && groupName.get(s.group_id)) || "Unsorted"} · {TYPE_LABEL[s.type] ?? s.type} · {s.min_plan ? PLAN_LABEL[s.min_plan] ?? s.min_plan : "Free"} · order {s.order_index} · {s.is_published ? "🟢 published" : "⚪ draft"}
                </span>
              </summary>
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {s.type === "mcq_test" && (
                    <Link className="btn small" href={`/admin/mcq/${s.id}`}>
                      🧠 Add / generate questions →
                    </Link>
                  )}
                  {s.type === "subjective_test" && (
                    <Link className="btn small" href={`/admin/subjective/${s.id}`}>
                      📝 Set up paper / questions (timed test) →
                    </Link>
                  )}
                  {s.type === "full_class_video" && !!(s.config as Record<string, unknown> | null)?.transcript && (
                    <form action={summarizeClassSection} style={{ display: "inline" }}>
                      <input type="hidden" name="sectionId" value={s.id} />
                      <input type="hidden" name="topicId" value={topic.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓ Done">🤖 Class summary (from transcript)</SubmitButton>
                    </form>
                  )}
                  <form action={toggleSectionPublish} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="topicId" value={topic.id} />
                    <input type="hidden" name="next" value={s.is_published ? "false" : "true"} />
                    <SubmitButton className="btn small secondary">
                      {s.is_published ? "Unpublish" : "Publish"}
                    </SubmitButton>
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

              {(() => {
                const isClass = s.type === "full_class_video" || s.type === "revision_video";
                if (!isClass) return null;
                const cfg = (s.config as Record<string, unknown> | null) ?? {};
                const uniqueNo = cfg.class_number as string | undefined;
                const classNo = cfg.class_no as string | undefined;
                const topicClassNo = cfg.topic_class_no as string | undefined;
                const mins = Number(cfg.duration_minutes) || 0;
                const isRev = s.type === "revision_video";
                return (
                  <div style={{ marginTop: 14, padding: "14px", background: "var(--bg-soft)", borderRadius: 8, textAlign: "center" }}>
                    {uniqueNo ? (
                      <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: "1.5rem", letterSpacing: "1px" }}>
                        {uniqueNo}
                      </div>
                    ) : (
                      <div style={{ fontWeight: 600, fontSize: ".88rem", color: "#b45309" }}>
                        🔢 Number not set yet — open <em>Edit section</em> below and set the month taught
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginTop: 6, fontWeight: 700, fontSize: ".88rem" }}>
                      {!isRev && topicClassNo && <span>Topic class no {topicClassNo}</span>}
                      {classNo && <span>{isRev ? "Revision no" : "Class no"} {classNo}</span>}
                      {mins > 0 && <span>⏱️ {fmtMins(mins)}</span>}
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginTop: 16 }}>
                <strong style={{ fontSize: ".9rem" }}>✏️ Edit this section (rename, video, PDF, tier…)</strong>
                <div style={{ marginTop: 10 }}>
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
                      group_id: (s as { group_id?: string | null }).group_id ?? null,
                    }}
                    submitLabel="Save section"
                    subjectCode={subjectCode}
                    topicCode={topicCode}
                    groups={groupList}
                    kindMode={["full_class_video", "revision_video", "discussion_video"].includes(s.type)}
                  />
                </div>
              </div>
            </details>
          ))
        ) : (
          <p className="muted">No sections yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
