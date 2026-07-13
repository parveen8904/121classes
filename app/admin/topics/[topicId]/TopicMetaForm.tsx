"use client";

import { useState } from "react";
import SubmitButton from "@/app/components/SubmitButton";
import AttemptPicker from "@/app/components/AttemptPicker";

export type TopicMeta = {
  id: string;
  title: string;
  is_combined: boolean;
  topic_code: string | null;
  weightage_marks: number | null;
  importance: Record<string, string> | null;
  valid_from_attempt: string | null;
  valid_to_attempt: string | null;
  amendments_upto: string | null;
  application_notes: string | null;
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
  const [updateComing, setUpdateComing] = useState(topic.update_coming);

  return (
    <form action={action} className="form-card" style={{ marginTop: 12 }}>
      <input type="hidden" name="topicId" value={topic.id} />

      <div>
        <label>Topic name</label>
        <input name="title" defaultValue={topic.title} placeholder="e.g. AS 13 – Accounting for Investments" required />
      </div>

      <div style={{ marginTop: 8 }}>
        <label>Topic short code — max 6 characters (used to build class numbers)</label>
        <input name="topic_code" defaultValue={topic.topic_code ?? ""} maxLength={6} placeholder="e.g. AS13 or IAS115" style={{ textTransform: "uppercase" }} />
      </div>

      {/* Weightage + applicability are set once at the SUBJECT level for all
          chapters. These fields are an OPTIONAL override — leave both blank and
          this topic inherits the subject's applicable-attempt window. Only set
          them for a special case (an updated/superseded chapter that applies to
          a different attempt than the rest of the subject). */}
      <h4 style={{ margin: "16px 0 4px" }}>📅 Applicable attempt — override (optional)</h4>
      <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 6px" }}>
        Leave blank to use the subject&apos;s setting (the normal case). Fill these only to override
        this one chapter.
      </p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
        <div>
          <label>Override — applies from attempt</label>
          <AttemptPicker name="valid_from_attempt" defaultValue={topic.valid_from_attempt ?? ""} allowNone />
        </div>
        <div>
          <label>Override — applies to attempt</label>
          <AttemptPicker name="valid_to_attempt" defaultValue={topic.valid_to_attempt ?? ""} allowNone />
        </div>
      </div>
      <label style={{ marginTop: 8 }}>Amendments up to</label>
      <input name="amendments_upto" defaultValue={topic.amendments_upto ?? ""} placeholder="e.g. Finance Act 2025" />

      <label style={{ marginTop: 8 }}>📌 Application notes — shown prominently to students (e.g. for an updated version of this topic)</label>
      <textarea name="application_notes" rows={3} defaultValue={topic.application_notes ?? ""} placeholder="e.g. This topic was updated for Sep 2028 — please read: the treatment of forex investments has changed…" />

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

      <h4 style={{ margin: "16px 0 4px" }}>📌 Important questions</h4>
      <label>Most important questions — first revision (one per line)</label>
      <textarea name="important_qs_rev1" rows={4} defaultValue={topic.important_qs_rev1 ?? ""} placeholder={"Q1 — ...\nQ2 — ..."} />
      <label style={{ marginTop: 8 }}>Most important questions — second revision (one per line)</label>
      <textarea name="important_qs_rev2" rows={4} defaultValue={topic.important_qs_rev2 ?? ""} placeholder={"Q1 — ...\nQ2 — ..."} />
      <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>
        📚 Upload the book / ICAI / RTP / past-paper / question-bank PDFs once in <strong>&ldquo;Topic materials&rdquo;</strong> (above) — they show to students AND train the AI. No separate upload here.
      </p>

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

      <SubmitButton className="btn" closeDetails style={{ marginTop: 14 }}>Save topic details</SubmitButton>
    </form>
  );
}
