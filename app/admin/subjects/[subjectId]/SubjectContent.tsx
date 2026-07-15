import PdfUpload from "../../_components/PdfUpload";
import SubmitButton from "@/app/components/SubmitButton";
import AttemptPicker from "@/app/components/AttemptPicker";
import DeleteButton from "../../_components/DeleteButton";
import { saveSubjectMIQ, saveSubjectWeightage, addSubjectMaterial, deleteSubjectMaterial, editSubjectMaterial } from "./actions";

type Topic = { id: string; title: string; weightage_marks: number | null };
type Material = { id: string; kind: string; title: string; valid_from_attempt: string | null; valid_to_attempt: string | null; solution_url?: string | null };

// MTP / RTP / past papers become full "practice papers": question + suggested
// answers, and students can upload their own answers for AI evaluation.
const PAPER_KINDS = ["mtp", "rtp", "past_papers"];

const KIND_LABEL: Record<string, string> = { icai: "🏛️ ICAI study material", mtp: "📄 MTP", rtp: "📄 RTP", past_papers: "🗂️ Past exam papers" };

// Everything a SUBJECT needs, in one screen: per-chapter weightage, the two
// most-important-question lists, and attempt-tagged MTP / RTP / past papers /
// ICAI uploads. ICAI is AI-only (copyright); the rest are shown to students.
export default function SubjectContent({
  subjectId, miqRev1, miqRev2, topics, materials,
}: {
  subjectId: string; miqRev1: string; miqRev2: string; topics: Topic[]; materials: Material[];
}) {
  const byKind = (k: string) => materials.filter((m) => m.kind === k);

  const MaterialBlock = ({ kind, withRange }: { kind: string; withRange?: boolean }) => (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
      <strong>{KIND_LABEL[kind]}{kind === "icai" ? " — 🔒 AI only (not shown to students)" : ""}</strong>
      <div style={{ display: "grid", gap: 6, margin: "8px 0" }}>
        {byKind(kind).length === 0 && <span className="muted" style={{ fontSize: ".82rem" }}>None uploaded yet.</span>}
        {byKind(kind).map((m) => (
          <div key={m.id} style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "6px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: ".85rem" }}>
                <strong>{m.title}</strong>
                {m.valid_from_attempt && <span className="muted"> · {withRange && m.valid_to_attempt ? `till ${m.valid_to_attempt}` : m.valid_from_attempt}</span>}
                {PAPER_KINDS.includes(kind) && <span className="muted"> · {m.solution_url ? "✅ has suggested answers (AI evaluation on)" : "⚠️ no suggested answers"}</span>}
              </span>
              <DeleteButton action={deleteSubjectMaterial} id={m.id} parentId={subjectId} message="Remove this material?" />
            </div>
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: ".8rem", color: "var(--accent)" }}>✏️ Edit / replace{PAPER_KINDS.includes(kind) && !m.solution_url ? " — add suggested answers" : ""}</summary>
              <form action={editSubjectMaterial} style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="subjectId" value={subjectId} />
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: kind === "icai" ? "1fr" : "1fr 1fr" }}>
                  <div><label>Name</label><input name="title" defaultValue={m.title} /></div>
                  {kind !== "icai" && (
                    <div>
                      <label>{withRange ? "Till which attempt" : "For which attempt"}</label>
                      <AttemptPicker name={withRange ? "valid_to_attempt" : "valid_from_attempt"} defaultValue={(withRange ? m.valid_to_attempt : m.valid_from_attempt) ?? ""} allowNone />
                    </div>
                  )}
                </div>
                <PdfUpload name="file_url" folder="repository" label={`Replace ${PAPER_KINDS.includes(kind) ? "question paper" : "PDF"} (leave blank to keep current)`} />
                {PAPER_KINDS.includes(kind) && (
                  <PdfUpload name="solution_url" folder="repository" label={m.solution_url ? "Replace suggested-answers PDF (leave blank to keep)" : "➕ Add suggested-answers PDF (turns on AI evaluation)"} />
                )}
                <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save changes</SubmitButton>
              </form>
            </details>
          </div>
        ))}
      </div>
      <form action={addSubjectMaterial}>
        <input type="hidden" name="subjectId" value={subjectId} />
        <input type="hidden" name="kind" value={kind} />
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: kind === "icai" ? "1fr" : "1fr 1fr" }}>
          <div><label>Name</label><input name="title" placeholder={`e.g. ${KIND_LABEL[kind].replace(/[^\w ]/g, "").trim()}`} /></div>
          {kind !== "icai" && (
            <div>
              <label>{withRange ? "Till which attempt" : "For which attempt"}</label>
              <AttemptPicker name={withRange ? "valid_to_attempt" : "valid_from_attempt"} />
            </div>
          )}
        </div>
        <PdfUpload name="file_url" folder="repository" label={PAPER_KINDS.includes(kind) ? "Question paper PDF" : "PDF (text auto-extracted for the AI)"} />
        {PAPER_KINDS.includes(kind) && (
          <PdfUpload name="solution_url" folder="repository" label="Suggested answers PDF (optional — students can then upload their own answers for AI evaluation)" />
        )}
        <SubmitButton className="btn small" savedLabel="✓ Added" style={{ marginTop: 8 }}>Add {KIND_LABEL[kind].replace(/[^\w ]/g, "").trim()}</SubmitButton>
      </form>
    </div>
  );

  return (
    <details className="card" id="subject-content" style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>📦 Subject content — weightage, important questions, RTP/MTP/past papers, ICAI</summary>

      {/* 1) Weightage per chapter (entered once here for every topic). */}
      <form action={saveSubjectWeightage} style={{ marginTop: 14 }}>
        <input type="hidden" name="id" value={subjectId} />
        <strong>⚖️ Chapter weightage (ICAI marks)</strong>
        <div style={{ display: "grid", gap: 6, margin: "8px 0", gridTemplateColumns: "1fr", maxWidth: 520 }}>
          {topics.map((t) => (
            <label key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: ".88rem" }}>{t.title}</span>
              <input name={`w_${t.id}`} type="number" min={0} defaultValue={t.weightage_marks ?? ""} placeholder="marks" style={{ width: 90 }} />
            </label>
          ))}
        </div>
        <SubmitButton className="btn small" savedLabel="✓ Saved">Save weightage</SubmitButton>
      </form>

      {/* 2) Most important questions — first & second revision. */}
      <form action={saveSubjectMIQ} style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <input type="hidden" name="id" value={subjectId} />
        <strong>📌 Most important questions</strong>
        <label style={{ marginTop: 8 }}>First revision list</label>
        <textarea name="miq_rev1" rows={3} defaultValue={miqRev1} placeholder="Paste the first-revision most-important-questions list." />
        <label>Second revision list</label>
        <textarea name="miq_rev2" rows={3} defaultValue={miqRev2} placeholder="Paste the second-revision most-important-questions list." />
        <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save important questions</SubmitButton>
      </form>

      {/* 3) Attempt-tagged materials. */}
      <MaterialBlock kind="rtp" />
      <MaterialBlock kind="mtp" />
      <MaterialBlock kind="past_papers" withRange />
      <MaterialBlock kind="icai" />

      {/* 4) Custom subject content — ANY name, with a PDF or a video link.
          Shown to students under "Subject resources" on their course page. */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
        <strong>✨ Custom content — any name, PDF or video</strong>
        <div style={{ display: "grid", gap: 6, margin: "8px 0" }}>
          {byKind("custom").length === 0 && <span className="muted" style={{ fontSize: ".82rem" }}>Nothing added yet.</span>}
          {byKind("custom").map((m) => (
            <div key={m.id} style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "6px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: ".85rem" }}><strong>{m.title}</strong>{m.valid_from_attempt && <span className="muted"> · {m.valid_from_attempt}</span>}</span>
                <DeleteButton action={deleteSubjectMaterial} id={m.id} parentId={subjectId} message="Remove this content?" />
              </div>
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: ".8rem", color: "var(--accent)" }}>✏️ Edit / replace</summary>
                <form action={editSubjectMaterial} style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="subjectId" value={subjectId} />
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                    <div><label>Name (what students see)</label><input name="title" defaultValue={m.title} /></div>
                    <div><label>For which attempt (optional)</label><AttemptPicker name="valid_from_attempt" defaultValue={m.valid_from_attempt ?? ""} allowNone /></div>
                  </div>
                  <PdfUpload name="file_url" folder="repository" label="Replace PDF (leave blank to keep current)" />
                  <label style={{ marginTop: 8 }}>🎬 Replace video link (leave blank to keep)</label>
                  <input name="video_url" placeholder="https://youtu.be/…" />
                  <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save changes</SubmitButton>
                </form>
              </details>
            </div>
          ))}
        </div>
        <form action={addSubjectMaterial}>
          <input type="hidden" name="subjectId" value={subjectId} />
          <input type="hidden" name="kind" value="custom" />
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <div><label>Name (what students see)</label><input name="title" placeholder="e.g. Ind AS summary charts" required /></div>
            <div><label>For which attempt (optional)</label><AttemptPicker name="valid_from_attempt" allowNone /></div>
          </div>
          <PdfUpload name="file_url" folder="repository" label="PDF (optional — or give a video link below)" />
          <label style={{ marginTop: 8 }}>🎬 Video link (optional — YouTube / any video URL)</label>
          <input name="video_url" placeholder="https://youtu.be/…" />
          <label className="remember" style={{ marginTop: 8 }}>
            <input type="checkbox" name="ai_only" /> 🔒 AI only — train the AI but don&apos;t show students
          </label>
          <SubmitButton className="btn small" savedLabel="✓ Added" style={{ marginTop: 8 }}>Add content</SubmitButton>
        </form>
      </div>
    </details>
  );
}
