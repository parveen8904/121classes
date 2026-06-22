"use client";

import { useState } from "react";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../../_components/DeleteButton";
import { ANNOUNCEMENT_KINDS as KINDS, ANNOUNCEMENT_KIND_LABEL as KIND_LABEL } from "@/lib/announcements";

type Post = {
  id: string;
  title: string;
  kind: string;
  body: string | null;
  link_url: string | null;
  is_published: boolean;
  broadcast_at: string | null;
  from_feed: boolean;
};

type Action = (fd: FormData) => void | Promise<void>;
type Actions = {
  updateAnnouncement: Action;
  deleteAnnouncement: Action;
  broadcast: Action;
  bulkPublish: Action;
  bulkUnpublish: Action;
  bulkDelete: Action;
};

function KindSelect({ value }: { value: string }) {
  return (
    <select name="kind" defaultValue={value}>
      {KINDS.map((k) => (
        <option key={k.value} value={k.value}>{k.label}</option>
      ))}
    </select>
  );
}

export default function PostsManager({ posts, actions }: { posts: Post[]; actions: Actions }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"all" | "draft" | "published">("all");

  const visible = posts.filter((p) => (tab === "all" ? true : tab === "draft" ? !p.is_published : p.is_published));
  const visIds = visible.map((p) => p.id);
  const allChecked = visible.length > 0 && visible.every((p) => sel.has(p.id));

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSel((s) => {
      const n = new Set(s);
      if (allChecked) visIds.forEach((id) => n.delete(id));
      else visIds.forEach((id) => n.add(id));
      return n;
    });
  const switchTab = (t: "all" | "draft" | "published") => { setSel(new Set()); setTab(t); };

  const ids = [...sel];
  const guard = (e: React.MouseEvent) => {
    if (sel.size === 0) { e.preventDefault(); window.alert("Tick at least one post first."); }
  };
  const confirmDelete = (e: React.MouseEvent) => {
    if (sel.size === 0) { e.preventDefault(); window.alert("Tick at least one post first."); return; }
    if (!window.confirm(`Remove ${sel.size} selected post(s)? This cannot be undone.`)) e.preventDefault();
  };

  return (
    <div>
      {/* Sticky bulk toolbar — selection lives in React state and is submitted as
          hidden inputs, so multi-select / multi-delete is reliable. */}
      <form
        className="card"
        style={{ position: "sticky", top: 8, zIndex: 5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14, background: "var(--bg-soft, #f8fafc)" }}
      >
        {ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
        <label className="remember" style={{ margin: 0, fontWeight: 600 }}>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} /> Select all
        </label>
        <span className="muted" style={{ fontSize: ".82rem" }}>{sel.size} selected →</span>
        <button className="btn small" type="submit" formAction={actions.bulkPublish} onClick={guard}>✅ Publish</button>
        <button className="btn small secondary" type="submit" formAction={actions.bulkUnpublish} onClick={guard}>⬜ Unpublish</button>
        <button className="btn small secondary" type="submit" formAction={actions.bulkDelete} onClick={confirmDelete} style={{ marginLeft: "auto", color: "#b91c1c" }}>🗑️ Delete selected</button>
      </form>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {(["all", "draft", "published"] as const).map((t) => (
          <button key={t} type="button" className={`btn small ${tab === t ? "" : "secondary"}`} onClick={() => switchTab(t)}>
            {t === "all" ? `All (${posts.length})` : t === "draft" ? `Drafts (${posts.filter((p) => !p.is_published).length})` : `Published (${posts.filter((p) => p.is_published).length})`}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {visible.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          visible.map((a) => (
            <div className="card" key={a.id}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} aria-label="Select" style={{ width: 18, height: 18, flexShrink: 0 }} />
                <details style={{ flex: 1, minWidth: 0 }}>
                  <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{a.title}</strong>
                    <span className="muted" style={{ fontSize: ".82rem" }}>
                      {KIND_LABEL[a.kind] ?? a.kind} · {a.is_published ? "🟢 published" : "⚪ draft"}
                      {a.from_feed ? " · 📰 feed" : ""}{a.broadcast_at ? " · 📢" : ""}
                    </span>
                  </summary>

                  {a.link_url && (
                    <p style={{ margin: "12px 0 0" }}>
                      <a href={a.link_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".9rem", wordBreak: "break-word" }}>
                        🔗 Open &amp; read the full article →
                      </a>
                    </p>
                  )}
                  {a.body && (
                    <p className="muted" style={{ fontSize: ".88rem", lineHeight: 1.5, margin: "8px 0 0" }}>{a.body}</p>
                  )}

                  <form action={actions.updateAnnouncement} style={{ marginTop: 12 }}>
                    <input type="hidden" name="id" value={a.id} />
                    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr" }}>
                      <div>
                        <label>Category</label>
                        <KindSelect value={a.kind} />
                      </div>
                      <div>
                        <label>Title</label>
                        <input name="title" defaultValue={a.title} required />
                      </div>
                    </div>
                    <label>Body</label>
                    <textarea name="body" rows={3} defaultValue={a.body ?? ""} />
                    <label>Link URL</label>
                    <input name="link_url" defaultValue={a.link_url ?? ""} />
                    <label className="remember" style={{ marginTop: 0 }}>
                      <input type="checkbox" name="is_published" defaultChecked={a.is_published} /> Published
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <SubmitButton className="btn small" closeDetails>Save changes</SubmitButton>
                      <DeleteButton action={actions.deleteAnnouncement} id={a.id} label="🗑️ Remove" message="Remove this post? This cannot be undone." />
                    </div>
                  </form>

                  <form action={actions.broadcast} style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="btn small secondary" savedLabel="📢 Sent">
                      {a.broadcast_at ? "📢 Broadcast again to students" : "📢 Send to students (mobile + Telegram)"}
                    </SubmitButton>
                  </form>
                </details>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
