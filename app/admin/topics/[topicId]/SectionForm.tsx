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

export default function SectionForm({
  action,
  topicId,
  section,
  submitLabel = "Add section",
  defaultType,
}: {
  action: (formData: FormData) => void | Promise<void>;
  topicId: string;
  section?: Section;
  submitLabel?: string;
  defaultType?: string;
}) {
  const [type, setType] = useState(section?.type ?? defaultType ?? "revision_video");
  const def = SECTION_TYPES.find((t) => t.value === type);
  const cfg = (section?.config ?? {}) as Record<string, string>;

  return (
    <form action={action}>
      {section && <input type="hidden" name="id" value={section.id} />}
      <input type="hidden" name="topicId" value={topicId} />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1.3fr 0.7fr" }}>
        <div>
          <label>Title</label>
          <input name="title" defaultValue={section?.title ?? ""} placeholder="e.g. First revision" required />
        </div>
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
