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
  group_id?: string | null;
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

  const sub = clean(subjectCode);
  const top = clean(topicCode);
  // Revision videos keep a manual revision number. Classes are numbered
  // automatically from their order (see the resequence step on save).
  const revCode = sub + yymm(taughtOn) + top + "R" + pad(classNo, 2);
  const revReady = sub && top && taughtOn && classNo;

  return (
    <div style={{ marginBottom: 14, padding: "12px 14px", background: "var(--bg-soft)", borderRadius: 10 }}>
      <strong style={{ fontSize: ".9rem" }}>🔢 Unique number — built for you</strong>
      {(!sub || !top) && (
        <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0", color: "#b45309" }}>
          {!sub ? "Set a 2-letter subject code (Subject → settings). " : ""}
          {!top ? "Set the topic short code (Topic details above). " : ""}
        </p>
      )}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isRevision ? "1.3fr 1fr" : "1fr", marginTop: 8 }}>
        <div>
          <label>Month taught (year + month)</label>
          <input type="month" value={taughtOn} onChange={(e) => setTaughtOn(e.target.value)} />
        </div>
        {isRevision && (
          <div>
            <label>Revision number</label>
            <input inputMode="numeric" value={classNo} onChange={(e) => setClassNo(e.target.value)} placeholder="01" />
          </div>
        )}
      </div>
      {isRevision ? (
        <p style={{ margin: "10px 0 0", fontSize: "1.05rem", letterSpacing: ".5px" }}>
          {revReady ? <strong>{revCode}</strong> : <span className="muted">Fill the boxes above…</span>}
        </p>
      ) : (
        <p className="muted" style={{ margin: "10px 0 0", fontSize: ".82rem" }}>
          🔁 The <strong>class number</strong> and <strong>topic class number</strong> are assigned
          automatically from the order. Set the <strong>Order</strong> above to place this class — the whole
          subject re-numbers itself. A class of <strong>100 minutes or less</strong> is added as a
          <strong> part (B, C…)</strong> of the previous class instead of a new number, so the class count
          stays clean. The full unique number appears once you save.
        </p>
      )}
      {/* taught month is submitted; for a revision the manual number + code go too. */}
      <input type="hidden" name="taught_on" value={taughtOn} />
      {isRevision && <input type="hidden" name="class_no" value={classNo} />}
      {isRevision && <input type="hidden" name="class_number" value={revReady ? revCode : ""} />}
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
  groups = [],
  kindMode = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  topicId: string;
  section?: Section;
  submitLabel?: string;
  defaultType?: string;
  lockType?: boolean;
  subjectCode?: string;
  topicCode?: string;
  groups?: { id: string; name: string }[];
  kindMode?: boolean;
}) {
  // A "video" content item can be a detailed class, a revision-round video, or a
  // plain video — the Kind decides the underlying type + numbering.
  const KIND_TO_TYPE: Record<string, string> = {
    class: "full_class_video",
    rev1: "revision_video",
    rev2: "revision_video",
    video: "discussion_video",
  };
  const cfg = (section?.config ?? {}) as Record<string, string>;
  const initKind =
    section
      ? section.type === "full_class_video"
        ? "class"
        : section.type === "revision_video"
          ? cfg.revision_round === "Second"
            ? "rev2"
            : "rev1"
          : "video"
      : "class";
  const [kind, setKind] = useState(initKind);
  const [typeState, setTypeState] = useState(section?.type ?? defaultType ?? "full_class_video");
  const type = kindMode ? KIND_TO_TYPE[kind] : typeState;
  const def = SECTION_TYPES.find((t) => t.value === type);
  const showAutoNumber = type === "full_class_video" || type === "revision_video";
  const isAdd = !section;
  const [resetN, setResetN] = useState(0);

  // For an "add" form: after the save completes, remount the fields so they
  // clear automatically (no manual page refresh). Editing keeps its values.
  async function handleAdd(formData: FormData) {
    await action(formData);
    setResetN((n) => n + 1);
  }

  return (
    <form action={isAdd ? handleAdd : action}>
      {section && <input type="hidden" name="id" value={section.id} />}
      <input type="hidden" name="topicId" value={topicId} />
      <div key={resetN}>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: lockType && !kindMode ? "3fr 0.7fr" : "2fr 1.3fr 0.7fr" }}>
        <div>
          <label>Title</label>
          <input name="title" defaultValue={section?.title ?? ""} placeholder="e.g. AS 13 — Class 1" required />
        </div>
        {kindMode ? (
          <div>
            <label>Kind (sets the numbering)</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="class">🎓 Detailed class (auto 1, 2, 3…)</option>
              <option value="rev1">🎬 Revision — Round 1 (R1)</option>
              <option value="rev2">🎬 Revision — Round 2 (R2)</option>
              <option value="video">🎞️ Plain video (no number)</option>
            </select>
            <input type="hidden" name="type" value={type} />
            {(kind === "rev1" || kind === "rev2") && (
              <input type="hidden" name="revision_round" value={kind === "rev2" ? "Second" : "First"} />
            )}
          </div>
        ) : lockType ? (
          <input type="hidden" name="type" value={type} />
        ) : (
          <div>
            <label>Type</label>
            <select name="type" value={type} onChange={(e) => setTypeState(e.target.value)}>
              {SECTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label>{showAutoNumber ? "Order (seq.)" : "Order"}</label>
          <input name="order_index" type="number" defaultValue={section?.order_index ?? 0} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
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
        <div>
          <label>Section (group)</label>
          <select name="group_id" defaultValue={section?.group_id ?? ""}>
            <option value="">— Unsorted —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      </div>

      {showAutoNumber && (
        <AutoNumber isRevision={type === "revision_video"} subjectCode={subjectCode} topicCode={topicCode} cfg={cfg} />
      )}

      {def && def.fields.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {def.fields.filter((f) => !(kindMode && f === "revision_round")).map((f: ConfigField) =>
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

      {/* Universal: a description + a link, shown to students for ANY content. */}
      <label>📝 Description (optional — shown to students)</label>
      <textarea name="description" rows={2} defaultValue={cfg.description ?? ""} placeholder="A short note shown under this content for students" />
      <label>🔗 Link (optional — becomes a clickable link for students)</label>
      <input name="link_url" defaultValue={cfg.link_url ?? ""} placeholder="https://…" />

        <label className="remember" style={{ marginTop: 8 }}>
          <input type="checkbox" name="is_published" defaultChecked={section?.is_published ?? false} /> Published
        </label>
      </div>
      <SubmitButton className="btn" closeDetails>{submitLabel}</SubmitButton>
    </form>
  );
}
