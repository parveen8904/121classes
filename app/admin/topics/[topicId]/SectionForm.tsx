"use client";

import { useState } from "react";
import { SECTION_TYPES, FIELD_LABELS, PLAN_OPTIONS, TEXTAREA_FIELDS, PDF_FIELDS, type ConfigField } from "./sectionTypes";
import BunnyUploader from "./BunnyUploader";
import PdfUpload from "../../_components/PdfUpload";
import SubmitButton from "@/app/components/SubmitButton";

type Section = {
  id: string;
  type: string;
  title: string;
  order_index: number;
  min_plan: string | null;
  config: Record<string, unknown> | null;
  is_published: boolean;
};

// Builds the unique class/revision number the founder described, e.g.
// AA · 2503 · AS13 · 01 · 01 → AA2503AS130101
//   AA   = subject code        (2 letters)
//   2503 = year + month taught (YY + MM, e.g. 2025-03 → 2503)
//   AS13 = topic short code
//   01   = class number   (R<nn> for a revision video)
//   01   = number within the topic
function clean(s: string) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function pad(s: string, width: number) {
  const d = (s || "").replace(/\D/g, "");
  return d ? d.padStart(width, "0").slice(-width) : "";
}
function yymm(date: string) {
  // date is YYYY-MM (month picker) → last two digits of year + month, e.g. 2025-03 → 2503
  if (!date || date.length < 7) return "";
  return date.slice(2, 4) + date.slice(5, 7);
}

function AutoNumber({
  isRevision,
  subjectCode,
  topicCode,
  cfg,
}: {
  isRevision: boolean;
  subjectCode: string;
  topicCode: string;
  cfg: Record<string, string>;
}) {
  const [taughtOn, setTaughtOn] = useState(cfg.taught_on ?? "");
  const [classNo, setClassNo] = useState(cfg.class_no ?? "");
  const [topicClassNo, setTopicClassNo] = useState(cfg.topic_class_no ?? "");

  const sub = clean(subjectCode);
  const top = clean(topicCode);
  // Order: subject · year+month · topic · TOPIC-class no (2 digits) · CLASS no (3 digits).
  // Class no is 3 digits (001) since a subject can have 100+ classes; the
  // within-topic number stays 2 digits. A revision number stays 2 digits.
  const code =
    sub +
    yymm(taughtOn) +
    top +
    (isRevision ? "R" + pad(classNo, 2) : pad(topicClassNo, 2) + pad(classNo, 3));

  const ready = sub && top && taughtOn && classNo && (isRevision || topicClassNo);

  return (
    <div style={{ marginBottom: 14, padding: "12px 14px", background: "var(--bg-soft)", borderRadius: 10 }}>
      <strong style={{ fontSize: ".9rem" }}>🔢 Unique number — built for you</strong>
      {(!sub || !top) && (
        <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0", color: "#b45309" }}>
          {!sub ? "Set a 2-letter subject code (Subject → settings). " : ""}
          {!top ? "Set the topic short code (Topic details above). " : ""}
        </p>
      )}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isRevision ? "1.3fr 1fr" : "1.3fr 1fr 1fr", marginTop: 8 }}>
        <div>
          <label>Month taught (year + month)</label>
          <input type="month" value={taughtOn} onChange={(e) => setTaughtOn(e.target.value)} />
        </div>
        {!isRevision && (
          <div>
            <label>Topic class no</label>
            <input inputMode="numeric" value={topicClassNo} onChange={(e) => setTopicClassNo(e.target.value)} placeholder="01" />
          </div>
        )}
        <div>
          <label>{isRevision ? "Revision number" : "Class no"}</label>
          <input inputMode="numeric" value={classNo} onChange={(e) => setClassNo(e.target.value)} placeholder={isRevision ? "01" : "001"} />
        </div>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: "1.05rem", letterSpacing: ".5px" }}>
        {ready ? <strong>{code}</strong> : <span className="muted">Fill the boxes above…</span>}
      </p>
      {/* raw inputs (so editing pre-fills) + the generated number that flows everywhere */}
      <input type="hidden" name="taught_on" value={taughtOn} />
      <input type="hidden" name="class_no" value={classNo} />
      <input type="hidden" name="topic_class_no" value={topicClassNo} />
      <input type="hidden" name="class_number" value={ready ? code : ""} />
    </div>
  );
}

export default function SectionForm({
  action,
  topicId,
  section,
  submitLabel = "Add section",
  defaultType,
  lockType = true,
  subjectCode = "",
  topicCode = "",
}: {
  action: (formData: FormData) => void | Promise<void>;
  topicId: string;
  section?: Section;
  submitLabel?: string;
  defaultType?: string;
  lockType?: boolean;
  subjectCode?: string;
  topicCode?: string;
}) {
  const [type, setType] = useState(section?.type ?? defaultType ?? "full_class_video");
  const def = SECTION_TYPES.find((t) => t.value === type);
  const cfg = (section?.config ?? {}) as Record<string, string>;
  const showAutoNumber = type === "full_class_video" || type === "revision_video";

  return (
    <form action={action}>
      {section && <input type="hidden" name="id" value={section.id} />}
      <input type="hidden" name="topicId" value={topicId} />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: lockType ? "3fr 0.7fr" : "2fr 1.3fr 0.7fr" }}>
        <div>
          <label>Title</label>
          <input name="title" defaultValue={section?.title ?? ""} placeholder="e.g. First revision" required />
        </div>
        {lockType ? (
          <input type="hidden" name="type" value={type} />
        ) : (
          <div>
            <label>Type</label>
            <select name="type" value={type} onChange={(e) => setType(e.target.value)}>
              {SECTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label>Order</label>
          <input name="order_index" type="number" defaultValue={section?.order_index ?? 0} />
        </div>
      </div>

      <div>
        <label>Minimum plan</label>
        <select name="min_plan" defaultValue={section?.min_plan ?? ""}>
          {PLAN_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {showAutoNumber && (
        <AutoNumber isRevision={type === "revision_video"} subjectCode={subjectCode} topicCode={topicCode} cfg={cfg} />
      )}

      {def && def.fields.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {def.fields.map((f: ConfigField) =>
            f === "bunny_video_id" ? (
              <BunnyUploader key={f} name={f} defaultValue={cfg[f] ?? ""} />
            ) : PDF_FIELDS.includes(f) ? (
              <PdfUpload key={f} name={f} defaultValue={cfg[f] ?? ""} label={FIELD_LABELS[f]} />
            ) : TEXTAREA_FIELDS.includes(f) ? (
              <div key={f}>
                <label>{FIELD_LABELS[f]}</label>
                <textarea name={f} rows={f === "transcript" ? 6 : 3} defaultValue={cfg[f] ?? ""} />
              </div>
            ) : f === "duration_minutes" ? (
              <div key={f}>
                <label>{FIELD_LABELS[f]}</label>
                <input name={f} type="number" min={0} step={5} defaultValue={cfg[f] ?? ""} />
              </div>
            ) : f === "revision_round" ? (
              <div key={f}>
                <label>{FIELD_LABELS[f]}</label>
                <select name={f} defaultValue={cfg[f] ?? ""}>
                  <option value="">—</option>
                  <option value="First">First</option>
                  <option value="Second">Second</option>
                </select>
              </div>
            ) : f === "bunny_drm" ? (
              <div key={f}>
                <label>{FIELD_LABELS[f]}</label>
                <select name={f} defaultValue={cfg[f] ?? "drm"}>
                  <option value="drm">🔒 DRM / protected (secure token player)</option>
                  <option value="off">▶️ Standard — no DRM</option>
                </select>
              </div>
            ) : f === "body" ? (
              <div key={f}>
                <label>{FIELD_LABELS[f]}</label>
                <textarea name={f} rows={4} defaultValue={cfg[f] ?? ""} />
              </div>
            ) : f === "starts_at" ? (
              <div key={f}>
                <label>{FIELD_LABELS[f]}</label>
                <input type="datetime-local" name={f} defaultValue={cfg[f] ?? ""} />
              </div>
            ) : (
              <div key={f}>
                <label>{FIELD_LABELS[f]}</label>
                <input name={f} defaultValue={cfg[f] ?? ""} />
              </div>
            ),
          )}
        </div>
      )}

      {def?.note && (
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 12 }}>
          {def.note}
        </p>
      )}

      <label className="remember" style={{ marginTop: 0 }}>
        <input type="checkbox" name="is_published" defaultChecked={section?.is_published ?? false} /> Published
      </label>
      <SubmitButton className="btn">{submitLabel}</SubmitButton>
    </form>
  );
}
