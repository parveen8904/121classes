// Shared section-type metadata used by both the form (client) and the
// server action. Each type declares which config fields it shows.

export type ConfigField =
  | "revision_round"
  | "bunny_video_id"
  | "youtube_url"
  | "pdf_url"
  | "body"
  | "zoom_webinar_id"
  | "join_url"
  | "starts_at";

export const ALL_CONFIG_FIELDS: ConfigField[] = [
  "revision_round",
  "bunny_video_id",
  "youtube_url",
  "pdf_url",
  "body",
  "zoom_webinar_id",
  "join_url",
  "starts_at",
];

export const FIELD_LABELS: Record<ConfigField, string> = {
  revision_round: "Revision round (First / Second)",
  bunny_video_id: "Bunny.net video ID",
  youtube_url: "YouTube URL (optional, marketing copy)",
  pdf_url: "PDF URL / storage path",
  body: "Body text / notes",
  zoom_webinar_id: "Zoom webinar ID",
  join_url: "Join URL",
  starts_at: "Starts at (e.g. 2026-07-01 18:00)",
};

export const SECTION_TYPES: {
  value: string;
  label: string;
  fields: ConfigField[];
  note?: string;
}[] = [
  { value: "revision_video", label: "Revision video", fields: ["revision_round", "bunny_video_id", "youtube_url"] },
  { value: "full_class_video", label: "Full class video", fields: ["bunny_video_id", "youtube_url"] },
  { value: "pdf", label: "PDF / notes", fields: ["pdf_url"] },
  { value: "rich_text", label: "Rich text / notes", fields: ["body"] },
  { value: "past_papers", label: "Past papers", fields: ["pdf_url", "body"] },
  { value: "live_class", label: "Live class (Zoom)", fields: ["zoom_webinar_id", "join_url", "starts_at"] },
  { value: "ask_doubt", label: "Ask a doubt (AI)", fields: [], note: "No config — renders the AI doubt box for students." },
  { value: "mcq_test", label: "MCQ test", fields: [], note: "Questions are added later (Phase 7)." },
  { value: "subjective_test", label: "Subjective test", fields: [], note: "Questions are added later (Phase 7)." },
  { value: "custom", label: "Custom section", fields: ["body", "bunny_video_id", "youtube_url", "pdf_url"] },
];

export const PLAN_OPTIONS = [
  { value: "", label: "Free (no subscription needed)" },
  { value: "bronze", label: "Bronze and up" },
  { value: "silver", label: "Silver and up" },
  { value: "gold", label: "Gold only" },
];
