// Shared section-type metadata used by both the form (client) and the
// server action. Each type declares which config fields it shows.

export type ConfigField =
  | "revision_round"
  | "bunny_video_id"
  | "bunny_drm"
  | "youtube_url"
  | "embed_url"
  | "pdf_url"
  | "body"
  | "zoom_webinar_id"
  | "join_url"
  | "starts_at"
  | "recording_url"
  // class-level fields (used by the unified AI repository / planner)
  | "class_number"
  | "taught_on"
  | "class_no"
  | "topic_class_no"
  | "video_ref"
  | "duration_minutes"
  | "notes_hand_url"
  | "notes_typed_url"
  | "transcript"
  | "important_questions"
  | "important_concepts"
  | "homework"
  | "homework_solutions"
  | "description"
  | "link_url";

export const ALL_CONFIG_FIELDS: ConfigField[] = [
  "revision_round",
  "bunny_video_id",
  "bunny_drm",
  "youtube_url",
  "embed_url",
  "pdf_url",
  "body",
  "zoom_webinar_id",
  "join_url",
  "starts_at",
  "recording_url",
  "class_number",
  "taught_on",
  "class_no",
  "topic_class_no",
  "video_ref",
  "duration_minutes",
  "notes_hand_url",
  "notes_typed_url",
  "transcript",
  "important_questions",
  "important_concepts",
  "homework",
  "homework_solutions",
  "description",
  "link_url",
];

export const FIELD_LABELS: Record<ConfigField, string> = {
  revision_round: "Revision round (First / Second)",
  bunny_video_id: "Bunny.net Stream video ID (secure premium player)",
  bunny_drm: "Protection",
  youtube_url: "YouTube URL (optional, marketing copy)",
  embed_url: "Embed URL (HeyGen / other iframe src)",
  pdf_url: "PDF URL / storage path",
  body: "Body text / notes",
  zoom_webinar_id: "Zoom/Meet webinar ID (optional)",
  join_url: "Join link (Zoom / Google Meet / any)",
  starts_at: "Starts at",
  recording_url: "Recording link (after the class — YouTube/embed)",
  class_number: "Unique number (auto-generated)",
  taught_on: "When was this taught?",
  class_no: "Class number",
  topic_class_no: "Class number within this topic",
  video_ref: "Video reference number",
  duration_minutes: "Class duration (minutes) — used by the study planner",
  notes_hand_url: "Handwritten notes PDF",
  notes_typed_url: "Typed notes PDF",
  transcript: "Transcript (powers AI answers — paste the class text)",
  important_questions: "Important questions discussed (one per line)",
  important_concepts: "Important concepts covered (one per line)",
  homework: "Homework (questions for this class)",
  homework_solutions: "Homework solutions PDF",
  description: "Description (shown to students under this content)",
  link_url: "Link (becomes a clickable link for students)",
};

// Long-text fields rendered as a textarea; PDF fields rendered with the uploader.
export const TEXTAREA_FIELDS: ConfigField[] = ["body", "transcript", "important_questions", "important_concepts", "homework", "description"];
export const PDF_FIELDS: ConfigField[] = ["pdf_url", "notes_hand_url", "notes_typed_url", "homework_solutions"];

export const SECTION_TYPES: {
  value: string;
  label: string;
  fields: ConfigField[];
  note?: string;
}[] = [
  { value: "revision_video", label: "Revision video", fields: ["revision_round", "bunny_video_id", "bunny_drm", "pdf_url", "transcript", "youtube_url", "embed_url"] },
  {
    value: "full_class_video",
    label: "🎓 Class (video + PDF + transcript)",
    fields: ["bunny_video_id", "bunny_drm", "duration_minutes", "notes_hand_url", "notes_typed_url", "transcript", "youtube_url", "embed_url"],
    note: "A class: lecture video, its PDF (handwritten/typed notes) and the transcript. The AI builds the class summary (questions/concepts/homework) from the transcript — no need to type those.",
  },
  { value: "discussion_video", label: "Discussion / walkthrough video", fields: ["bunny_video_id", "bunny_drm", "youtube_url", "embed_url"] },
  {
    value: "discussion",
    label: "Discussion board (Q&A)",
    fields: ["body"],
    note: "Students post questions; you and others reply with text, a PDF, or a video reference (e.g. 'Video 7 @ 12:30'). Use the body for instructions/homework.",
  },
  { value: "pdf", label: "PDF / notes", fields: ["pdf_url"] },
  { value: "rich_text", label: "Rich text / notes", fields: ["body"] },
  {
    value: "homework",
    label: "📚 Homework",
    fields: ["body", "pdf_url"],
    note: "Post the homework questions in the body and/or attach a PDF. Pair it with a Discussion board section for Q&A.",
  },
  { value: "past_papers", label: "Past papers", fields: ["pdf_url", "body"] },
  { value: "live_class", label: "Live class (Zoom/Meet)", fields: ["join_url", "starts_at", "zoom_webinar_id", "recording_url"] },
  { value: "ask_doubt", label: "Ask a doubt (AI)", fields: [], note: "No config — renders the AI doubt box for students." },
  { value: "mcq_test", label: "MCQ test", fields: [], note: "Give it a title and save. Then click '🧠 Add / generate questions' on the section to add MCQs (paste, upload a PDF, or generate)." },
  { value: "subjective_test", label: "Descriptive test (timed paper / typed Q&A)", fields: [], note: "Give it a title and save. Then click '📝 Set up paper / questions (timed test)' on the new section to upload the question + solution PDFs and set the time + marks." },
  { value: "custom", label: "Custom section", fields: ["body", "bunny_video_id", "youtube_url", "embed_url", "pdf_url"] },
];

export const PLAN_OPTIONS = [
  { value: "", label: "🆓 Free — everyone" },
  { value: "bronze", label: "🥉 Bronze (free)" },
  { value: "silver", label: "🥈 Silver (paid — tests)" },
  { value: "gold", label: "🥇 Gold (paid — premium classes)" },
];
