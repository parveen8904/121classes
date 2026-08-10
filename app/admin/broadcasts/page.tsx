import { formatDateTime } from "@/lib/dates";
import AdminHero from "../_components/AdminHero";
import VideoUpload from "../_components/VideoUpload";
import SubmitButton from "@/app/components/SubmitButton";
import ChannelFolders, { type Folder } from "./ChannelFolders";
import ManageFolders from "./ManageFolders";
import DeleteButton from "../_components/DeleteButton";
import { createServiceClient } from "@/lib/supabase/service";
import { deletePost, sendPostNow, updatePost } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns — Admin" };

type Post = {
  id: string; body: string; link_url: string | null; send_at: string;
  to_tg_channel: boolean; to_tg_groups: boolean; to_discord: boolean; to_direct: boolean;
  campaign: string | null; to_whatsapp: boolean; wa_template: string | null;
  to_instagram: boolean; to_youtube: boolean; to_yt_video: boolean; to_twitter: boolean;
  to_linkedin: boolean; to_facebook: boolean; to_substack: boolean; to_medium: boolean;
  to_reddit: boolean; to_quora: boolean; to_google: boolean; to_threads: boolean; to_ig_personal: boolean;
  ig_text: string | null; yt_text: string | null; x_text: string | null; video_url: string | null; created_by: string | null;
  source_kind: string | null; source_label: string | null; source_url: string | null;
  status: string; status_note: string | null; sent_at: string | null;
};

// UTC instant → value for a datetime-local input showing IST wall-clock time.
const istInput = (s: string) => new Date(new Date(s).getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 16);

const istFmt = (s: string) =>
  formatDateTime(s);

function Targets({ p }: { p: Post }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {p.to_tg_channel && <span className="badge">✈️ Channel</span>}
      {p.to_tg_groups && <span className="badge">👥 TG groups</span>}
      {p.to_discord && <span className="badge">🎮 Discord</span>}
      {p.to_direct && <span className="badge">📩 Direct to students</span>}
      {p.to_whatsapp && <span className="badge">💬 WhatsApp</span>}
      {p.to_instagram && <span className="badge">📷 Instagram</span>}
      {p.to_youtube && <span className="badge">▶️ YouTube (remind)</span>}
      {p.to_yt_video && <span className="badge">🎥 YouTube video brief</span>}
      {p.to_twitter && <span className="badge">🐦 Twitter/X</span>}
      {p.to_threads && <span className="badge">🧵 Threads</span>}
      {p.to_ig_personal && <span className="badge">📸 IG personal</span>}
      {p.to_linkedin && <span className="badge">💼 LinkedIn</span>}
      {p.to_facebook && <span className="badge">📘 Facebook</span>}
      {p.to_substack && <span className="badge">📰 Substack (remind)</span>}
      {p.to_medium && <span className="badge">✒️ Medium (remind)</span>}
      {p.to_reddit && <span className="badge">👽 Reddit</span>}
      {p.to_quora && <span className="badge">❓ Quora (remind)</span>}
      {p.to_google && <span className="badge">📍 Google Profile (remind)</span>}
    </span>
  );
}

// Every channel a post can go to — one list, used by the compose form and by
// each post's own edit form so a post can be re-routed after it was written.
const CHANNEL_BOXES: { name: string; label: string; auto: boolean }[] = [
  { name: "to_tg_channel", label: "✈️ Telegram channel", auto: true },
  { name: "to_tg_groups", label: "👥 Subject Telegram groups", auto: true },
  { name: "to_discord", label: "🎮 Discord", auto: true },
  { name: "to_direct", label: "📩 Direct to every connected student", auto: true },
  { name: "to_whatsapp", label: "💬 WhatsApp (every student + lead)", auto: true },
  { name: "to_instagram", label: "📷 Instagram — Reel when a video is attached", auto: true },
  { name: "to_youtube", label: "▶️ YouTube community post", auto: false },
  { name: "to_yt_video", label: "🎥 YouTube — Short when a video is attached", auto: false },
  { name: "to_twitter", label: "🐦 Twitter/X", auto: true },
  { name: "to_linkedin", label: "💼 LinkedIn", auto: true },
  { name: "to_facebook", label: "📘 Facebook page — Reel when a video is attached", auto: true },
  { name: "to_ig_personal", label: "📸 Instagram (personal)", auto: false },
  { name: "to_threads", label: "🧵 Threads", auto: false },
  { name: "to_reddit", label: "👽 Reddit", auto: true },
  { name: "to_substack", label: "📰 Substack", auto: false },
  { name: "to_medium", label: "✒️ Medium", auto: false },
  { name: "to_quora", label: "❓ Quora", auto: false },
  { name: "to_google", label: "📍 Google Business Profile", auto: false },
];

// Why this post exists — shown on every one, so nothing on the list is a
// mystery ("on what basis was this written?" was a fair question).
const KIND_ICON: Record<string, string> = { news: "📰 from the news", greeting: "🎉 a greeting", event: "📅 an event", idea: "💡 an idea" };

function Reason({ p }: { p: Post }) {
  if (p.source_kind) {
    const label = KIND_ICON[p.source_kind] ?? p.source_kind;
    return (
      <>
        <strong>{label}</strong>
        {p.source_label ? <>: {p.source_url
          ? <a href={p.source_url} target="_blank" rel="noopener noreferrer">{p.source_label}</a>
          : p.source_label}</> : null} ·{" "}
      </>
    );
  }
  if (p.created_by === "autopilot") return <>🤖 autopilot · </>;
  if (p.created_by === "pack") return <>✨ pack · </>;
  if (p.created_by === "campaign") return <>✨ campaign · </>;
  return null;
}

export default async function BroadcastsPage(props: { searchParams: Promise<{ made?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const { data: folderRows } = await svc.from("channel_folders").select("id, name, icon, channels").order("sort").order("name");
  const folders = (folderRows ?? []) as Folder[];
  const { data } = await svc
    .from("scheduled_posts")
    .select("*")
    .order("send_at", { ascending: false })
    .limit(60);
  const posts = (data ?? []) as Post[];
  const pending = posts.filter((p) => p.status === "pending").sort((a, b) => a.send_at.localeCompare(b.send_at));
  const done = posts.filter((p) => p.status !== "pending");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📣 Campaigns"
        title="Posts & settings"
        subtitle="Every post scheduled or sent — read it, change it, move it, or delete it. ⏰"
        back={{ href: "/admin/campaigns", label: "Marketing" }}
      />

      <ManageFolders folders={folders} boxes={CHANNEL_BOXES.map((c) => ({ name: c.name, label: c.label }))} />

      {searchParams.made && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✨ Written — <strong>{searchParams.made} post(s)</strong> from what you chose, waiting below. Read them, change
          anything, delete what you don&apos;t want.
        </div>
      )}
      {/* Upcoming */}
      <h3 style={{ margin: "22px 0 8px" }}>⏳ Upcoming ({pending.length})</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {pending.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing scheduled.</p></div>}
        {pending.map((p) => (
          <div className="list-row" key={p.id} style={{ flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="row-title" style={{ whiteSpace: "pre-wrap" }}>{p.body.length > 140 ? p.body.slice(0, 140) + "…" : p.body}</span>
              <p className="row-sub">
                <Reason p={p} />
                {p.campaign ? <>📣 {p.campaign} · </> : null}🕐 {istFmt(p.send_at)} IST · <Targets p={p} />
              </p>
            </div>
            <div className="row-actions">
              {p.to_instagram && (
                <a className="btn small secondary" href={`/api/campaign-card/${p.id}`} target="_blank" rel="noopener noreferrer" title="Auto-generated 1080×1080 image for this post — save it and attach in Instagram">
                  🖼️ IG card
                </a>
              )}
              <form action={sendPostNow} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton className="btn small">Send now</SubmitButton>
              </form>
              <DeleteButton action={deletePost} id={p.id} message="Delete this scheduled post?" />
            </div>
            <details style={{ flexBasis: "100%", marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: ".8rem", color: "var(--accent)" }}>✏️ Edit this post — text, channels, timing</summary>
              <form id={`edit-${p.id}`} action={updatePost} style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                <input type="hidden" name="id" value={p.id} />
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label>Campaign name</label>
                    <input name="campaign" defaultValue={p.campaign ?? ""} placeholder="optional" />
                  </div>
                  <div>
                    <label>Post at (IST)</label>
                    <input type="datetime-local" name="send_at" defaultValue={istInput(p.send_at)} />
                  </div>
                </div>
                <label style={{ marginTop: 8 }}>Message <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem" }}>— used by every channel that has no version of its own below</span></label>
                <textarea name="body" rows={4} defaultValue={p.body} required />
                <label style={{ marginTop: 8 }}>Link (optional — added at the end)</label>
                <input name="link_url" defaultValue={p.link_url ?? ""} placeholder="https://caparveensharma.com/free-planner" />

                <VideoUpload name="video_url" defaultValue={p.video_url ?? ""} />

                <label style={{ marginTop: 10 }}>📷 Instagram caption <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem" }}>— blank = use the message above</span></label>
                <textarea name="ig_text" rows={3} defaultValue={p.ig_text ?? ""} />
                <label style={{ marginTop: 8 }}>▶️ YouTube community text</label>
                <textarea name="yt_text" rows={2} defaultValue={p.yt_text ?? ""} />
                <label style={{ marginTop: 8 }}>🐦 Twitter/X post <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem" }}>— keep it under 280 characters</span></label>
                <textarea name="x_text" rows={2} defaultValue={p.x_text ?? ""} />

                <label style={{ marginTop: 10 }}>Where this one post goes</label>
                <ChannelFolders folders={folders} formId={`edit-${p.id}`} />
                <div style={{ display: "grid", gap: 4, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
                  {CHANNEL_BOXES.map((c) => (
                    <label key={c.name} className="remember" style={{ margin: 0, fontSize: ".82rem" }}>
                      <input type="checkbox" name={c.name} defaultChecked={Boolean(p[c.name as keyof Post])} /> {c.label}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 6, maxWidth: 320 }}>
                  <label style={{ fontSize: ".8rem" }}>WhatsApp template name (only if WhatsApp is ticked)</label>
                  <input name="wa_template" defaultValue={p.wa_template ?? ""} placeholder="e.g. marketing_update" />
                </div>
                <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 10 }}>Save changes</SubmitButton>
                <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>
                  Everything on this post is yours to change — untick a channel and it will not go there at all.
                </p>
              </form>
            </details>
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
                {p.campaign ? <>📣 {p.campaign} · </> : null}
                {p.status === "sent" ? "✅ sent" : "❌ failed"} {p.sent_at ? `· ${istFmt(p.sent_at)} IST` : ""} · <Targets p={p} />
                {p.status_note ? ` · ${p.status_note}` : ""}
              </p>
            </div>
            <div className="row-actions">
              {p.to_instagram && (
                <a className="btn small secondary" href={`/api/campaign-card/${p.id}`} target="_blank" rel="noopener noreferrer" title="Auto-generated 1080×1080 image for this post">
                  🖼️ IG card
                </a>
              )}
              <DeleteButton action={deletePost} id={p.id} message="Remove from history?" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
