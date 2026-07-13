import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured } from "@/lib/ai";
import SubmitButton from "@/app/components/SubmitButton";
import AdminHero from "../_components/AdminHero";
import PdfUpload from "../_components/PdfUpload";
import { addRepositoryItem, deleteRepositoryItem, toggleRepositoryItem, extractItemText } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Repository — Admin" };

const KIND_LABEL: Record<string, string> = {
  transcript: "🎙️ Class transcript",
  book: "📕 Book PDF",
  icai: "🏛️ ICAI material",
  notes: "📝 Notes",
  important_qs: "📌 Important questions (master list)",
  revision_qs: "🔁 Revision questions list",
  other: "📦 Other",
};

type Item = {
  id: string;
  title: string;
  kind: string;
  subject_id: string | null;
  file_url: string | null;
  content: string | null;
  valid_from: string | null;
  valid_to: string | null;
  valid_from_attempt: string | null;
  is_active: boolean;
};

function fmtRange(from: string | null, to: string | null, attempt: string | null): string {
  const parts: string[] = [];
  if (from || to) parts.push(`${from || "…"} → ${to || "…"}`);
  if (attempt) parts.push(`from ${attempt}`);
  return parts.join(" · ") || "no validity set";
}

export default async function RepositoryPage() {
  const svc = createServiceClient();
  const [{ data: items }, { data: subjects }, { data: courses }, ai, { data: secs }] = await Promise.all([
    svc.from("repository_items").select("id, title, kind, subject_id, file_url, content, valid_from, valid_to, valid_from_attempt, is_active").order("created_at", { ascending: false }),
    svc.from("subjects").select("id, title").order("title"),
    svc.from("courses").select("id, title").order("title"),
    aiConfigured(),
    svc.from("sections").select("config").eq("type", "full_class_video").eq("is_published", true),
  ]);
  const list = (items ?? []) as Item[];
  const subjMap = new Map((subjects ?? []).map((s) => [s.id, s.title as string]));

  // What content the AI actually has to answer from.
  const cov = { total: 0, transcript: 0, digest: 0, notes_have: 0, notes_ocr: 0 };
  for (const s of secs ?? []) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    cov.total++;
    if (String(c.transcript ?? "").length > 100) cov.transcript++;
    if (String(c.ai_summary ?? "").trim()) cov.digest++;
    if (c.notes_hand_url) cov.notes_have++;
    if (String(c.notes_text ?? "").trim()) cov.notes_ocr++;
  }
  const books = list.filter((i) => i.is_active && (i.content ?? "").length > 100).length;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📚 AI Repository"
        title="Learning material for the AI"
        subtitle="Upload transcripts, book PDFs and ICAI material. The AI answers doubts and builds tests ONLY from what's here."
        back={{ href: "/admin", label: "Admin" }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <Link className="btn small secondary" href="/admin/repository/overview">📊 Overview — what&apos;s missing</Link>
      </div>

      {/* What the AI can actually read from, right now. */}
      <div className="card" style={{ marginTop: 12 }}>
        <strong>🧠 What the AI can answer from</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 10, textAlign: "center" }}>
          <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{cov.digest}/{cov.transcript}</div><div className="muted" style={{ fontSize: ".78rem" }}>class transcripts digested (used for doubts)</div></div>
          <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{cov.notes_ocr}/{cov.notes_have}</div><div className="muted" style={{ fontSize: ".78rem" }}>handwritten notes read into text</div></div>
          <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{books}</div><div className="muted" style={{ fontSize: ".78rem" }}>book / ICAI PDFs (text extracted)</div></div>
        </div>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 10, marginBottom: 0 }}>
          Doubts answer from the <strong>digests</strong> (cheap &amp; clean). Transcripts are digested automatically every hour.
          Handwritten notes and books need a one-time text extraction to feed the AI — {cov.notes_have - cov.notes_ocr} notes and
          uploaded books are not yet readable by the AI.
        </p>
      </div>

      {!ai && (
        <div className="notice" style={{ marginTop: 16, background: "var(--bg-soft)" }}>
          💡 Add your Anthropic key in <strong>Integrations</strong> to switch on AI answers & test generation. You can still build the repository now.
        </div>
      )}

      {/* ADD FORM — collapsed; list shows first */}
      <details style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ Add material</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
        <h3>➕ Add material</h3>
        <form action={addRepositoryItem}>
          <label>Name *</label>
          <input name="title" placeholder="e.g. FR — IND AS 115 — Class 1 transcript" required />

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Type</label>
              <select name="kind" defaultValue="transcript">
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label>Subject (optional)</label>
              <select name="subject_id" defaultValue="">
                <option value="">— Any / not subject-specific —</option>
                {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div>
              <label>Valid from (date)</label>
              <input name="valid_from" type="date" />
            </div>
            <div>
              <label>Valid to (date)</label>
              <input name="valid_to" type="date" />
            </div>
            <div>
              <label>Valid from attempt</label>
              <input name="valid_from_attempt" placeholder="e.g. May 2026" />
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <PdfUpload name="file_url" folder="repository" label="File (PDF — book / ICAI / notes)" />
          </div>

          <label style={{ marginTop: 8 }}>Text content (paste the transcript / key text the AI should learn) </label>
          <textarea name="content" rows={6} placeholder="Paste the class transcript or the important text here. This is what the AI reads to answer doubts and make questions." />
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
            Tip: transcripts work best pasted as text. For book/ICAI PDFs you can also paste the key portions here so the AI can use them.
            For <strong>Important questions</strong> / <strong>Revision questions</strong> lists, pick a Subject and paste <strong>one question per line</strong> — the study planner counts these and spreads them across the plan.
          </p>

          <label className="remember" style={{ marginTop: 10 }}>
            <input type="checkbox" name="share_to_resources" /> 🌐 Also share this PDF on the public <strong>Resources</strong> page (PDFs only)
          </label>
          <label style={{ marginTop: 4 }}>Resources page label (optional — defaults to the name)</label>
          <input name="resource_label" placeholder="e.g. ICAI RTP — May 2026 (FR)" />

          <SubmitButton className="btn" savedLabel="✓ Added" style={{ marginTop: 14 }}>Add to repository</SubmitButton>
        </form>
        </div>
      </details>

      {/* LIST */}
      <h3 style={{ marginTop: 30 }}>📦 In the repository ({list.length})</h3>
      {list.length === 0 ? (
        <p className="muted">Nothing added yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {list.map((it) => (
            <div className="card" key={it.id} style={{ opacity: it.is_active ? 1 : 0.55 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>{it.title}</strong>
                  <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
                    {KIND_LABEL[it.kind] ?? it.kind}
                    {it.subject_id ? ` · ${subjMap.get(it.subject_id) ?? "Subject"}` : ""}
                    {" · "}{fmtRange(it.valid_from, it.valid_to, it.valid_from_attempt)}
                    {it.content ? ` · ${it.content.length.toLocaleString()} chars of text` : it.file_url ? " · file only (no text yet)" : " · empty"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {it.file_url && <a className="btn small secondary" href={it.file_url} target="_blank" rel="noreferrer">View</a>}
                  {it.file_url && !it.content && /\.pdf($|\?)/i.test(it.file_url) && (
                    <form action={extractItemText} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={it.id} />
                      <button className="btn small secondary" type="submit">Extract text</button>
                    </form>
                  )}
                  <form action={toggleRepositoryItem} style={{ margin: 0 }}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="active" value={it.is_active ? "false" : "true"} />
                    <button className="btn small secondary" type="submit">{it.is_active ? "Disable" : "Enable"}</button>
                  </form>
                  <form action={deleteRepositoryItem} style={{ margin: 0 }}>
                    <input type="hidden" name="id" value={it.id} />
                    <button className="btn small secondary" type="submit">Delete</button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
