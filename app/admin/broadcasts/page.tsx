import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../_components/DeleteButton";
import { createServiceClient } from "@/lib/supabase/service";
import { schedulePost, deletePost, sendPostNow } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing broadcasts — Admin" };

type Audience = {
  name: string | null; email: string | null; telegram_id: string;
  level: string; enrolled: string; queries: number; source: string;
};

type Post = {
  id: string; body: string; link_url: string | null; send_at: string;
  to_tg_channel: boolean; to_tg_groups: boolean; to_discord: boolean; to_direct: boolean;
  status: string; status_note: string | null; sent_at: string | null;
};

const istFmt = (s: string) =>
  new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Targets({ p }: { p: Post }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {p.to_tg_channel && <span className="badge">✈️ Channel</span>}
      {p.to_tg_groups && <span className="badge">👥 TG groups</span>}
      {p.to_discord && <span className="badge">🎮 Discord</span>}
      {p.to_direct && <span className="badge">📩 Direct to students</span>}
    </span>
  );
}

export default async function BroadcastsPage() {
  const svc = createServiceClient();
  const { data } = await svc
    .from("scheduled_posts")
    .select("*")
    .order("send_at", { ascending: false })
    .limit(60);
  const posts = (data ?? []) as Post[];
  const { data: audData } = await svc.rpc("admin_dm_audience");
  const audience = (audData ?? []) as Audience[];
  const pending = posts.filter((p) => p.status === "pending").sort((a, b) => a.send_at.localeCompare(b.send_at));
  const done = posts.filter((p) => p.status !== "pending");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📢 Marketing broadcasts"
        title="Scheduled posts to Telegram & Discord"
        subtitle="Write a message once, pick a date & time (IST) and where it goes — the channel, every subject Telegram group, Discord — and it posts itself. ⏰"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Who receives direct messages */}
      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          📩 Direct-message audience — {audience.length} {audience.length === 1 ? "person" : "people"} reachable
        </summary>
        <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0" }}>
          Everyone here has pressed <strong>Start</strong> on the bot, so Telegram allows us to message them
          personally. Grows every time a student taps the bot (see the pinned &ldquo;press Start&rdquo; post).
        </p>
        {audience.length === 0 ? (
          <p className="muted" style={{ fontSize: ".85rem" }}>Nobody yet — once students press Start on @Caclassesbot they appear here with full details.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "6px 8px" }}>Name</th>
                  <th style={{ padding: "6px 8px" }}>Level</th>
                  <th style={{ padding: "6px 8px" }}>Email</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Telegram ID</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Enrolled</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Queries asked</th>
                  <th style={{ padding: "6px 8px" }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {audience.map((a, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{a.name || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{a.level}</td>
                    <td style={{ padding: "6px 8px" }}>{a.email || "—"}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: ".76rem" }}>{a.telegram_id}</td>
                    <td style={{ padding: "6px 8px" }}>{a.enrolled}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{a.queries}</td>
                    <td style={{ padding: "6px 8px" }}>{a.source === "portal student" ? "🎓 portal student" : "💬 bot subscriber"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {/* Compose */}
      <div className="form-card" style={{ marginTop: 16 }}>
        <h3>✍️ Schedule a post</h3>
        <form action={schedulePost}>
          <label>Message</label>
          <textarea name="body" rows={4} required placeholder={"🎉 New batch starting Monday!\nAdvanced Accounting — full syllabus with CA Parveen Sharma.\nSeats limited."} />
          <label style={{ marginTop: 8 }}>Link (optional — added at the end)</label>
          <input name="link_url" placeholder="https://caparveensharma.com/courses" />
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
            <div>
              <label>Post at (IST — Indian time)</label>
              <input type="datetime-local" name="send_at" required />
            </div>
            <div>
              <label>Post to</label>
              <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_tg_channel" defaultChecked /> ✈️ Telegram channel (broadcast)</label>
                <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_tg_groups" /> 👥 All subject Telegram groups</label>
                <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_discord" /> 🎮 All subject Discord channels</label>
                <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_direct" /> 📩 Direct message to every connected student (personal Telegram chat)</label>
              </div>
            </div>
          </div>
          <SubmitButton className="btn" savedLabel="✓ Scheduled" style={{ marginTop: 12 }}>⏰ Schedule post</SubmitButton>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
            Posts go out within ~10 minutes of the chosen time. Messages in groups are subject to the same
            moderation-free bot posting as announcements.
          </p>
        </form>
      </div>

      {/* Upcoming */}
      <h3 style={{ margin: "22px 0 8px" }}>⏳ Upcoming ({pending.length})</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {pending.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing scheduled.</p></div>}
        {pending.map((p) => (
          <div className="list-row" key={p.id}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title" style={{ whiteSpace: "pre-wrap" }}>{p.body.length > 140 ? p.body.slice(0, 140) + "…" : p.body}</span>
              <p className="row-sub">🕐 {istFmt(p.send_at)} IST · <Targets p={p} /></p>
            </div>
            <div className="row-actions">
              <form action={sendPostNow} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton className="btn small">Send now</SubmitButton>
              </form>
              <DeleteButton action={deletePost} id={p.id} message="Delete this scheduled post?" />
            </div>
          </div>
        ))}
      </div>

      {/* History */}
      <h3 style={{ margin: "22px 0 8px" }}>📜 Sent / past ({done.length})</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {done.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing sent yet.</p></div>}
        {done.map((p) => (
          <div className="list-row" key={p.id}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title" style={{ whiteSpace: "pre-wrap", fontWeight: 500 }}>{p.body.length > 140 ? p.body.slice(0, 140) + "…" : p.body}</span>
              <p className="row-sub">
                {p.status === "sent" ? "✅ sent" : "❌ failed"} {p.sent_at ? `· ${istFmt(p.sent_at)} IST` : ""} · <Targets p={p} />
                {p.status_note ? ` · ${p.status_note}` : ""}
              </p>
            </div>
            <div className="row-actions">
              <DeleteButton action={deletePost} id={p.id} message="Remove from history?" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
