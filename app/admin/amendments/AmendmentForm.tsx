"use client";

import { useState } from "react";
import BunnyUploader from "../topics/[topicId]/BunnyUploader";
import PdfUpload from "../_components/PdfUpload";
import AttemptPicker from "@/app/components/AttemptPicker";
import SubmitButton from "@/app/components/SubmitButton";

type Course = { id: string; title: string };
type Subject = { id: string; title: string; course_id: string };
type Topic = { id: string; title: string; subject_id: string };

export type AmendmentRow = {
  id: string;
  course_id: string | null;
  subject_id: string | null;
  topic_id: string | null;
  order_index: number;
  title: string;
  body: string | null;
  bunny_video_id: string | null;
  bunny_drm: string | null;
  youtube_url: string | null;
  embed_url: string | null;
  notes_hand_url: string | null;
  discussion: string | null;
  valid_from_attempt: string | null;
  valid_to_attempt: string | null;
  is_published: boolean;
};

export default function AmendmentForm({
  action,
  courses,
  subjects,
  topics,
  amendment,
  submitLabel = "Save amendment",
}: {
  action: (formData: FormData) => void | Promise<void>;
  courses: Course[];
  subjects: Subject[];
  topics: Topic[];
  amendment?: AmendmentRow;
  submitLabel?: string;
}) {
  const [courseId, setCourseId] = useState(amendment?.course_id ?? "");
  const [subjectId, setSubjectId] = useState(amendment?.subject_id ?? "");
  const [topicId, setTopicId] = useState(amendment?.topic_id ?? "");

  const subjectOpts = subjects.filter((s) => !courseId || s.course_id === courseId);
  const topicOpts = topics.filter((t) => !subjectId || t.subject_id === subjectId);

  return (
    <form action={action}>
      {amendment && <input type="hidden" name="id" value={amendment.id} />}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div>
          <label>Course</label>
          <select name="course_id" value={courseId} onChange={(e) => { setCourseId(e.target.value); setSubjectId(""); setTopicId(""); }}>
            <option value="">—</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <div>
          <label>Subject</label>
          <select name="subject_id" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setTopicId(""); }}>
            <option value="">—</option>
            {subjectOpts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
        <div>
          <label>Topic</label>
          <select name="topic_id" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">—</option>
            {topicOpts.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "3fr 1fr" }}>
        <div>
          <label>Title</label>
          <input name="title" defaultValue={amendment?.title ?? ""} placeholder="e.g. Amendment in AS 13 disclosure" required />
        </div>
        <div>
          <label>Serial / order</label>
          <input name="order_index" type="number" defaultValue={amendment?.order_index ?? 0} />
        </div>
      </div>

      <label>Amendment text (description)</label>
      <textarea name="body" rows={4} defaultValue={amendment?.body ?? ""} placeholder="What changed and why…" />

      <label>Applicable — from attempt → to attempt</label>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
        <AttemptPicker name="valid_from_attempt" defaultValue={amendment?.valid_from_attempt ?? ""} required />
        <span style={{ alignSelf: "center" }}>→</span>
        <AttemptPicker name="valid_to_attempt" defaultValue={amendment?.valid_to_attempt ?? ""} allowNone />
      </div>

      <BunnyUploader name="bunny_video_id" defaultValue={amendment?.bunny_video_id ?? ""} />
      <input type="hidden" name="bunny_drm" value="off" />
      <label>YouTube URL (optional)</label>
      <input name="youtube_url" defaultValue={amendment?.youtube_url ?? ""} placeholder="https://youtu.be/…" />
      <label>Embed URL (optional)</label>
      <input name="embed_url" defaultValue={amendment?.embed_url ?? ""} placeholder="iframe src…" />

      <PdfUpload name="notes_hand_url" defaultValue={amendment?.notes_hand_url ?? ""} label="Handwritten notes (PDF)" />

      <label>Discussion (optional)</label>
      <textarea name="discussion" rows={3} defaultValue={amendment?.discussion ?? ""} placeholder="Discussion / Q&A points" />

      <label className="remember" style={{ marginTop: 4 }}>
        <input type="checkbox" name="is_published" defaultChecked={amendment?.is_published ?? true} /> Published
      </label>
      <SubmitButton className="btn" closeDetails>{submitLabel}</SubmitButton>
    </form>
  );
}
