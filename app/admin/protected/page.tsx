import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import { createProtectedVideo, deleteProtectedVideo } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProtectedClassesPage() {
  // Subjects for the access dropdown (normal client is fine).
  const supabase = createClient();
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, title, courses(title)")
    .order("title");

  // protected_videos has no RLS read policy → use the service client (admin).
  const svc = createServiceClient();
  const { data: items } = await svc
    .from("protected_videos")
    .select("id, title, subject_id, min_plan, storage_url, is_published, byte_size, created_at")
    .order("created_at", { ascending: false });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🔐 Downloadable classes"
        title="Encrypted classes (desktop app)"
        subtitle="Encrypt a class with scripts/encrypt-class.mjs, host the .enc on Bunny Storage (recommended) or Google Drive — not Supabase — then register it here. The desktop app downloads it and unlocks it after an access check. 🖥️"
        back={{ href: "/admin", label: "Admin" }}
      />

      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ Register an encrypted class</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 0, marginBottom: 12 }}>
            Run <code>node scripts/encrypt-class.mjs class.mp4</code> → it prints the key, IV and size →
            upload the <code>.enc</code> file to your CDN → paste everything below.
          </p>
          <form action={createProtectedVideo}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr 1fr" }}>
              <div>
                <label>Title</label>
                <input name="title" placeholder="e.g. FR — AS 24 Class 1" required />
              </div>
              <div>
                <label>Subject (access check)</label>
                <select name="subject_id" defaultValue="">
                  <option value="">— None (open to any logged-in student)</option>
                  {(subjects ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s as { courses?: { title?: string } | null }).courses?.title
                        ? `${(s as { courses?: { title?: string } }).courses!.title} · `
                        : ""}
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Minimum plan</label>
                <select name="min_plan" defaultValue="gold">
                  <option value="gold">🥇 Gold</option>
                  <option value="silver">🥈 Silver</option>
                  <option value="bronze">🥉 Bronze (free)</option>
                </select>
              </div>
            </div>
            <label>Encrypted file URL — Bunny Storage / Google Drive direct link (storage_url)</label>
            <input name="storage_url" placeholder="https://…bunnycdn.com/class.enc" required />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
              <div>
                <label>key_b64</label>
                <input name="key_b64" placeholder="base64 key from the script" required />
              </div>
              <div>
                <label>iv_b64</label>
                <input name="iv_b64" placeholder="base64 IV" />
              </div>
              <div>
                <label>alg</label>
                <input name="alg" defaultValue="aes-256-cbc" />
              </div>
              <div>
                <label>byte_size</label>
                <input name="byte_size" type="number" placeholder="bytes" />
              </div>
            </div>
            <label className="remember" style={{ marginTop: 0 }}>
              <input type="checkbox" name="is_published" defaultChecked /> Published
            </label>
            <button className="btn" type="submit">
              Register class
            </button>
          </form>
        </div>
      </details>

      <h2 className="admin-section-title">🗂️ Registered classes</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {items && items.length > 0 ? (
          items.map((v) => (
            <div className="list-row" key={v.id}>
              <div>
                <span className="row-title">🔐 {v.title}</span>
                <p className="row-sub">
                  {v.min_plan} · {v.is_published ? "🟢 published" : "⚪ draft"}
                  {v.byte_size ? ` · ${(Number(v.byte_size) / 1e6).toFixed(0)} MB` : ""}
                </p>
              </div>
              <div className="row-actions">
                <DeleteButton action={deleteProtectedVideo} id={v.id} message="Remove this encrypted class?" />
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No encrypted classes yet — register one above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
