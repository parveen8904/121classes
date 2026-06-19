"use client";

import { useState } from "react";
import PdfUpload from "../../_components/PdfUpload";

export type TopicMeta = {
  id: string;
  is_combined: boolean;
  weightage_marks: number | null;
  importance: Record<string, string> | null;
  valid_from_attempt: string | null;
  valid_to_attempt: string | null;
  amendments_upto: string | null;
  important_qs_rev1: string | null;
  important_qs_rev2: string | null;
  book_pdf_url: string | null;
  icai_material_url: string | null;
  revision_video_url: string | null;
  revision_notes_hand_url: string | null;
  revision_notes_typed_url: string | null;
  update_coming: boolean;
  update_on: string | null;
  update_for: string | null;
  update_note: string | null;
  revision_paper_url: string | null;
  amendments_pdf_url: string | null;
};

export default function TopicMetaForm({
  topic,
  action,
}: {
  topic: TopicMeta;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [combined, setCombined] = useState(topic.is_combined);
  const [updateComing, setUpdateComing] = useState(topic.update_coming);

  return (
    <form action={action} className="form-card" style={{ marginTop: 12 }}>
      <input type="hidden" name="topicId" value={topic.id} />

      <label className="remember" style={{ marginTop: 0 }}>
        <input type="checkbox" name="is_combined" defaultChecked={topic.is_combined} onChange={(e) => setCombined(e.target.checked)} />{" "}
        🧩 This is the <strong>combined topic</strong> (covers the whole subject)
      </label>

      {/* Basics */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 8 }}>
        <div>
          <label>Weightage marks (ICAI){combined ? "" : " *"}</label>
          <input name="weightage_marks" type="number" min={0} defaultValue={topic.weightage_marks ?? ""} required={!combined} placeholder="e.g. 12" />
        </div>
        <div>
          <label>Applicable from attempt{combined ? "" : " *"}</label>
          <input name="valid_from_attempt" defaultValue={topic.valid_from_attempt ?? ""} required={!combined} placeholder="e.g. May 2026" />
        </div>
        <div>
          <label>Applicable to attempt</label>
          <input name="valid_to_attempt" defaultValue={topic.valid_to_attempt ?? ""} placeholder="(optional)" />
        </div>
      </div>
      <label style={{ marginTop: 8 }}>Amendments up to</label>
      <input name="amendments_upto" defaultValue={topic.amendments_upto ?? ""} placeholder="e.g. Finance Act 2025" />

      {!combined && (
        <>
          <label style={{ marginTop: 8 }}>
            🎯 Hit list — importance per attempt (one per line, <code>attempt | category</code>)
          </label>
          <textarea
            name="importance"
            rows={3}
            defaultValue={Object.entries(topic.importance ?? {}).map(([a, c]) => `${a} | ${c}`).join("\n")}
            placeholder={"May 2027 | A\nNov 2026 | B"}
          />
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
            A = most important / sure-shot, B = important, C = if time permits. Shown prominently to each student for the attempt they&apos;re sitting, and used to order the planner.
          </p>
        </>
      )}

      {!combined && (
        <>
          <h4 style={{ margin: "16px 0 4px" }}>📌 Important questions</h4>
          <label>Most important questions — first revision * (one per line)</label>
          <textarea name="important_qs_rev1" rows={4} defaultValue={topic.important_qs_rev1 ?? ""} required={!combined} placeholder={"Q1 — ...\nQ2 — ..."} />
          <label style={{ marginTop: 8 }}>Most important questions — second revision * (one per line)</label>
          <textarea name="important_qs_rev2" rows={4} defaultValue={topic.important_qs_rev2 ?? ""} required={!combined} placeholder={"Q1 — ...\nQ2 — ..."} />

          <h4 style={{ margin: "16px 0 4px" }}>📚 Topic materials</h4>
          <PdfUpload name="book_pdf_url" defaultValue={topic.book_pdf_url ?? ""} label="Book PDF for this topic" />
          <PdfUpload name="icai_material_url" defaultValue={topic.icai_material_url ?? ""} label="ICAI material PDF" />
          <label style={{ marginTop: 8 }}>Revision video link</label>
          <input name="revision_video_url" defaultValue={topic.revision_video_url ?? ""} placeholder="YouTube / Bunny / embed link" />
          <PdfUpload name="revision_notes_hand_url" defaultValue={topic.revision_notes_hand_url ?? ""} label="Revision video notes — handwritten PDF" />
          <PdfUpload name="revision_notes_typed_url" defaultValue={topic.revision_notes_typed_url ?? ""} label="Revision video notes — typed PDF" />
        </>
      )}

      {combined && (
        <>
          <h4 style={{ margin: "16px 0 4px" }}>🧩 Combined-topic materials (whole subject)</h4>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
            Add the 4–5 mock tests and past papers as <strong>sections</strong> below (MCQ / subjective / past-papers types). Add the subject-wide PDFs here:
          </p>
          <PdfUpload name="book_pdf_url" defaultValue={topic.book_pdf_url ?? ""} label="Full subject book PDF" />
          <PdfUpload name="revision_paper_url" defaultValue={topic.revision_paper_url ?? ""} label="ICAI full revision test paper PDF" />
          <PdfUpload name="amendments_pdf_url" defaultValue={topic.amendments_pdf_url ?? ""} label="Amendments PDF (for the attempt)" />
        </>
      )}

      {/* Updated-content notice */}
      <h4 style={{ margin: "16px 0 4px" }}>🔔 Updated content notice</h4>
      <label className="remember" style={{ marginTop: 0 }}>
        <input type="checkbox" name="update_coming" defaultChecked={topic.update_coming} onChange={(e) => setUpdateComing(e.target.checked)} />{" "}
        New / updated content is coming for this topic
      </label>
      {updateComing && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
          <div>
            <label>Coming on (date)</label>
            <input name="update_on" type="date" defaultValue={topic.update_on ?? ""} />
          </div>
          <div>
            <label>Applicable for (whom / which attempt)</label>
            <input name="update_for" defaultValue={topic.update_for ?? ""} placeholder="e.g. Nov 2026 attempt students" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Note shown to students</label>
            <input name="update_note" defaultValue={topic.update_note ?? ""} placeholder="e.g. Updated for the latest ICAI amendments" />
          </div>
        </div>
      )}
      {!updateComing && (
        <>
          <input type="hidden" name="update_on" value={topic.update_on ?? ""} />
          <input type="hidden" name="update_for" value={topic.update_for ?? ""} />
          <input type="hidden" name="update_note" value={topic.update_note ?? ""} />
        </>
      )}

      <button className="btn" type="submit" style={{ marginTop: 14 }}>Save topic details</button>
    </form>
  );
}
