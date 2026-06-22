import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postCommunity, deleteCommunity, pinCommunity } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Community — 121 CA Classes" };

type Row = {
  id: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  author_id: string;
  profiles: { full_name: string | null; role: string | null } | null;
};

function fmt(s: string): string {
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default async function CommunityPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/community");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = me?.role === "admin";

  // Telegram channel "read in browser" link (t.me/s/<name> opens without the app).
  const { data: chs } = await supabase.from("site_settings").select("key, value").in("key", ["support_telegram", "whatsapp_channel", "support_whatsapp"]);
  const cmap = new Map((chs ?? []).map((r) => [r.key, r.value as string]));
  const tg = cmap.get("support_telegram") || "";
  const tgWeb = tg.replace(/t\.me\/(s\/)?/, "t.me/s/"); // ensure the /s/ web-preview form
  const wa = cmap.get("whatsapp_channel") || cmap.get("support_whatsapp") || "";

  const { data } = await supabase
    .from("community_posts")
    .select("id, body, is_pinned, created_at, author_id, profiles(full_name, role)")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  const posts = (data ?? []) as unknown as Row[];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <div className="learn-hero">
        <span className="badge">💬 Community</span>
        <h1>Community board</h1>
        <p className="meta">Ask, share and discuss with fellow CA students — and updates from CA Parveen Sharma. 🤝</p>
      </div>

      {(tg || wa) && (
        <div className="card" style={{ marginTop: 14 }}>
          <strong>📣 Our channels</strong>
          <p className="muted" style={{ fontSize: ".84rem", margin: "4px 0 10px" }}>
            Read our Telegram channel right in your browser — no app needed.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tg && <a className="btn small" href={tgWeb} target="_blank" rel="noreferrer" style={{ background: "#229ED9" }}>✈️ Read Telegram channel (in browser)</a>}
            {tg && <a className="btn small secondary" href={tg} target="_blank" rel="noreferrer">Open in Telegram app</a>}
            {wa && <a className="btn small secondary" href={wa} target="_blank" rel="noreferrer" style={{ background: "#25D366", color: "#fff" }}>💬 Join WhatsApp channel</a>}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <form action={postCommunity}>
          <label>Write something</label>
          <textarea name="body" rows={3} placeholder="Share a question, tip or update…" required />
          {isAdmin && (
            <label className="remember" style={{ marginTop: 0 }}>
              <input type="checkbox" name="pin" /> 📌 Pin to top (announcement)
            </label>
          )}
          <button className="btn" type="submit">
            Post
          </button>
        </form>
      </div>

      <div style={{ marginTop: 22, display: "grid", gap: 12 }}>
        {posts.length === 0 && <p className="muted">No posts yet — start the conversation. ✨</p>}
        {posts.map((p) => {
          const facultyPost = p.profiles?.role === "admin";
          const canDelete = isAdmin || p.author_id === user.id;
          return (
            <div
              key={p.id}
              className="card"
              style={{ borderColor: p.is_pinned || facultyPost ? "var(--accent)" : "var(--border)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <p className="muted" style={{ fontSize: ".8rem", margin: 0 }}>
                  {p.is_pinned && <span className="lock-badge" style={{ marginRight: 8 }}>📌 Pinned</span>}
                  <strong style={{ color: facultyPost ? "var(--accent)" : "var(--text)" }}>
                    {facultyPost ? "CA Parveen Sharma" : p.profiles?.full_name?.trim() || "Student"}
                  </strong>{" "}
                  · {fmt(p.created_at)}
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  {isAdmin && (
                    <form action={pinCommunity} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="on" value={p.is_pinned ? "false" : "true"} />
                      <button className="btn small secondary" type="submit">
                        {p.is_pinned ? "Unpin" : "Pin"}
                      </button>
                    </form>
                  )}
                  {canDelete && (
                    <form action={deleteCommunity} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="btn small secondary" type="submit">
                        Delete
                      </button>
                    </form>
                  )}
                </div>
              </div>
              <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{p.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
