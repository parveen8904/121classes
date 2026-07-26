import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../_components/DeleteButton";
import { createServiceClient } from "@/lib/supabase/service";
import { schedulePost, deletePost, sendPostNow, generatePack, updatePost, toggleAutopilot, saveMarketingSettings } from "./actions";
import { CHANNELS, cadenceLabel } from "@/lib/marketingRhythm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns — Admin" };

type Audience = {
  name: string | null; email: string | null; telegram_id: string;
  level: string; enrolled: string; ai_questions: number; group_messages: number; source: string;
};

type Post = {
  id: string; body: string; link_url: string | null; send_at: string;
  to_tg_channel: boolean; to_tg_groups: boolean; to_discord: boolean; to_direct: boolean;
  campaign: string | null; to_whatsapp: boolean; wa_template: string | null;
  to_instagram: boolean; to_youtube: boolean; to_yt_video: boolean; to_twitter: boolean;
  to_linkedin: boolean; to_facebook: boolean; to_substack: boolean; to_medium: boolean;
  to_reddit: boolean; to_quora: boolean; to_google: boolean;
  ig_text: string | null; yt_text: string | null; created_by: string | null;
  status: string; status_note: string | null; sent_at: string | null;
};

// UTC instant → value for a datetime-local input showing IST wall-clock time.
const istInput = (s: string) => new Date(new Date(s).getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 16);

const istFmt = (s: string) =>
  new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Targets({ p }: { p: Post }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {p.to_tg_channel && <span className="badge">✈️ Channel</span>}
      {p.to_tg_groups && <span className="badge">👥 TG groups</span>}
      {p.to_discord && <span className="badge">🎮 Discord</span>}
      {p.to_direct && <span className="badge">📩 Direct to students</span>}
      {p.to_whatsapp && <span className="badge">💬 WhatsApp</span>}
      {p.to_instagram && <span className="badge">📷 Instagram (remind)</span>}
      {p.to_youtube && <span className="badge">▶️ YouTube (remind)</span>}
      {p.to_yt_video && <span className="badge">🎥 YouTube video brief</span>}
      {p.to_twitter && <span className="badge">🐦 Twitter (remind)</span>}
      {p.to_linkedin && <span className="badge">💼 LinkedIn (remind)</span>}
      {p.to_facebook && <span className="badge">📘 Facebook (remind)</span>}
      {p.to_substack && <span className="badge">📰 Substack (remind)</span>}
      {p.to_medium && <span className="badge">✒️ Medium (remind)</span>}
      {p.to_reddit && <span className="badge">👽 Reddit (remind)</span>}
      {p.to_quora && <span className="badge">❓ Quora (remind)</span>}
      {p.to_google && <span className="badge">📍 Google Profile (remind)</span>}
    </span>
  );
}

export default async function BroadcastsPage(props: { searchParams: Promise<{ pack?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const { data } = await svc
    .from("scheduled_posts")
    .select("*")
    .order("send_at", { ascending: false })
    .limit(60);
  const posts = (data ?? []) as Post[];
  const { data: audData } = await svc.rpc("admin_dm_audience");
  const audience = (audData ?? []) as Audience[];
  const { data: settingRows } = await svc.from("site_settings").select("key, value").in("key", ["marketing_autopilot", "marketing_poster_emails"]);
  const settings = new Map((settingRows ?? []).map((r) => [r.key, r.value as string]));
  const autopilotOn = settings.get("marketing_autopilot") === "on";
  const posterEmails = settings.get("marketing_poster_emails") ?? "";
  const pending = posts.filter((p) => p.status === "pending").sort((a, b) => a.send_at.localeCompare(b.send_at));
  const done = posts.filter((p) => p.status !== "pending");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📣 Campaigns"
        title="Marketing campaigns & broadcasts"
        subtitle="Write a message once, pick a date & time (IST) and the channels — Telegram, Discord and WhatsApp post automatically; Instagram & YouTube email you the ready-to-paste post at send time. ⏰"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.pack && searchParams.pack !== "fail" && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✨ Pack ready — <strong>{searchParams.pack} posts</strong> written and scheduled below. Read them, edit or delete any you don&apos;t like; the rest go out on time.
        </div>
      )}
      {searchParams.pack === "fail" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          Couldn&apos;t generate the pack — check the Anthropic key on Integrations and that &ldquo;Marketing pack generator&rdquo; is on in Admin → AI usage.
        </div>
      )}

      {/* Weekly autopilot */}
      <div className="card" style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <strong>{autopilotOn ? "🟢" : "⚪"} Weekly autopilot — quiet marketing</strong>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 0" }}>
            Every Monday morning it plans the whole week: <strong>one idea a day</strong>, written to teach — a concept
            students get wrong, an exam habit, an honest question — and rewritten in each platform&apos;s own voice.
            Roughly <strong>one day in three</strong> carries a single quiet line about something on the site; the rest
            ask for nothing. No offers, no &ldquo;join now&rdquo;, nothing that reads as an advertisement. Every post is
            scheduled below where you can edit or delete it, and the full week reaches you by email on Monday.
            WhatsApp is never included.
          </p>
        </div>
        <div style={{ display: "grid", gap: 6, justifyItems: "stretch" }}>
          <form action={toggleAutopilot} style={{ margin: 0 }}>
            <input type="hidden" name="next" value={autopilotOn ? "off" : "on"} />
            <SubmitButton className={`btn small ${autopilotOn ? "secondary" : ""}`}>
              {autopilotOn ? "Switch off" : "▶ Switch on autopilot"}
            </SubmitButton>
          </form>
          <a className="btn small secondary" href="/admin/broadcasts/preview" title="Writes a sample week so you can read the tone — nothing is scheduled or posted">
            👀 Preview next week&apos;s posts
          </a>
        </div>
      </div>

      {/* The rhythm each platform speaks on */}
      <details className="card" style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>📅 How often each place hears from us</summary>
        <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0" }}>
          A feed that fills up every day reads like an ad account. This is the rhythm the autopilot follows —
          daily only in our own rooms, and spaced out everywhere public.
        </p>
        <div style={{ display: "grid", gap: 4 }}>
          {CHANNELS.map((c) => (
            <div key={c.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: ".82rem", borderTop: "1px solid var(--border)", padding: "5px 0" }}>
              <span style={{ fontWeight: 600 }}>{c.label}</span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>
                {cadenceLabel(c)} · {String(c.hour).padStart(2, "0")}:{String(c.minute).padStart(2, "0")} IST
              </span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: ".76rem", margin: "8px 0 0" }}>
          Subject Telegram groups are deliberately left out — those are study rooms, and a daily post there is the
          one thing students would notice as marketing. To change a rhythm, tell the developer: it lives in
          <code style={{ fontSize: ".72rem" }}> lib/marketingRhythm.ts</code>.
        </p>
      </details>

      {/* Who does the Instagram/YouTube/Twitter pasting */}
      <div className="card" style={{ marginTop: 12 }}>
        <strong>📧 Who posts on Instagram / YouTube / Twitter?</strong>
        <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 8px" }}>
          These platforms can&apos;t auto-post, so we email the ready-to-paste text at post time. Enter a staff
          member&apos;s email to send those reminders to them instead of you (comma-separate for more than one). Blank = they come to the admins.
        </p>
        <form action={saveMarketingSettings} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input name="poster_emails" type="text" defaultValue={posterEmails} placeholder="assistant@example.com, social@example.com" style={{ flex: 1, minWidth: 240 }} />
          <SubmitButton className="btn small" savedLabel="✓ Saved">Save</SubmitButton>
        </form>
      </div>

      {/* One-click campaign pack */}
      <details className="form-card" style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>✨ Generate a campaign pack (AI writes it, you approve)</summary>
        <form action={generatePack} style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>What to promote</label>
              <select name="theme" defaultValue="The FREE day-by-day study planner">
                <option>The FREE day-by-day study planner</option>
                <option>FREE chapter MCQ tests with rank report</option>
                <option>Case-study practice for the new exam pattern</option>
                <option>New batch / course launch</option>
                <option>Live classes this week</option>
              </select>
            </div>
            <div>
              <label>…or type your own theme</label>
              <input name="custom_theme" placeholder="e.g. September attempt — last 60 days plan" />
            </div>
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 8 }}>
            <div><label>How many days</label><input name="days" type="number" min={1} max={14} defaultValue={7} /></div>
            <div><label>Start date</label><input name="start_date" type="date" /></div>
            <div><label>Post time (IST)</label><input name="post_time" type="time" defaultValue="19:00" /></div>
          </div>
          <label style={{ marginTop: 10 }}>Channels for every post in the pack</label>
          <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_tg_channel" defaultChecked /> ✈️ Telegram channel (auto)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_tg_groups" /> 👥 Subject Telegram groups (auto)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_discord" /> 🎮 Discord (auto)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_instagram" defaultChecked /> 📷 Instagram caption — emailed to you at post time</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_youtube" defaultChecked /> ▶️ YouTube community text — emailed to you at post time</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_twitter" /> 🐦 Twitter/X — auto-posts when keys are set (Integrations), else emailed</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_linkedin" /> 💼 LinkedIn — auto-posts when keys are set, else emailed</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_facebook" /> 📘 Facebook page — auto-posts when keys are set, else emailed</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_reddit" /> 👽 Reddit — auto-posts to your community when keys are set, else emailed</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_substack" /> 📰 Substack — draft emailed to expand into a newsletter (no posting API)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_medium" /> ✒️ Medium — draft emailed to expand into an article (no posting API)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_quora" /> ❓ Quora — draft emailed to answer related questions (no posting API)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_google" /> 📍 Google Business Profile — draft emailed to post as an Update</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_whatsapp" /> 💬 WhatsApp bulk (careful — every post goes to every contact)</label>
          </div>
          <div style={{ marginLeft: 24 }}>
            <label style={{ fontSize: ".8rem" }}>WhatsApp template name (only if WhatsApp is ticked)</label>
            <input name="wa_template" placeholder="e.g. marketing_update" style={{ maxWidth: 320 }} />
          </div>
          <SubmitButton className="btn" savedLabel="✓ Pack scheduled" style={{ marginTop: 12 }}>✨ Write & schedule the pack</SubmitButton>
          <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>
            The AI writes one post per day, each written to teach rather than to sell — a different angle every day,
            no invented claims, and the site mentioned only in passing. Everything lands in
            &ldquo;Upcoming&rdquo; below where you can edit or delete before it goes out.
          </p>
        </form>
      </details>

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
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>AI questions</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Group messages</th>
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
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{a.ai_questions}</td>
                    <td style={{ padding: "6px 8px" }}>{a.group_messages}</td>
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
        <h3>✍️ Schedule a campaign post</h3>
        <form action={schedulePost}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Campaign name (optional — groups posts together)</label>
              <input name="campaign" placeholder="e.g. Sept 2026 batch launch" />
            </div>
            <div>
              <label>Post at (IST — Indian time)</label>
              <input type="datetime-local" name="send_at" required />
            </div>
          </div>
          <label style={{ marginTop: 8 }}>Message</label>
          <textarea name="body" rows={4} required placeholder={"🎉 New batch starting Monday!\nAdvanced Accounting — full syllabus with CA Parveen Sharma.\nSeats limited."} />
          <label style={{ marginTop: 8 }}>Link (optional — added at the end)</label>
          <input name="link_url" placeholder="https://caparveensharma.com/courses" />

          <label style={{ marginTop: 10 }}>Channels — post automatically</label>
          <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_tg_channel" defaultChecked /> ✈️ Telegram channel (broadcast)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_tg_groups" /> 👥 All subject Telegram groups</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_discord" /> 🎮 All subject Discord channels</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_direct" /> 📩 Direct message to every connected student (personal Telegram chat)</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_whatsapp" /> 💬 WhatsApp to every student + imported lead with a phone number (via Interakt)</label>
          </div>
          <div style={{ marginLeft: 24 }}>
            <label style={{ fontSize: ".8rem" }}>WhatsApp template name (required for WhatsApp — an Interakt-approved template with one {"{{1}}"} variable; the message above fills it)</label>
            <input name="wa_template" placeholder="e.g. marketing_update" style={{ maxWidth: 320 }} />
          </div>

          <label style={{ marginTop: 10 }}>Channels — prepared &amp; emailed to you to post manually</label>
          <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_instagram" /> 📷 Instagram — at send time you get an email with the ready-to-paste post</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_youtube" /> ▶️ YouTube (community post) — same reminder email</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_yt_video" /> 🎥 YouTube video brief — emailed as a &ldquo;record this&rdquo; note, not a post</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_twitter" /> 🐦 Twitter/X — auto when keys set, else reminder email</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_linkedin" /> 💼 LinkedIn — auto when keys set, else reminder email</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_facebook" /> 📘 Facebook page — auto when keys set, else reminder email</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_reddit" /> 👽 Reddit — auto to your community when keys set, else reminder</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_substack" /> 📰 Substack — draft to expand into a newsletter</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_medium" /> ✒️ Medium — draft to expand into an article</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_quora" /> ❓ Quora — answer related questions</label>
            <label className="remember" style={{ margin: 0 }}><input type="checkbox" name="to_google" /> 📍 Google Business Profile — post as an Update</label>
          </div>
          <p className="muted" style={{ fontSize: ".76rem", margin: "4px 0 0" }}>
            Instagram &amp; YouTube don&apos;t allow reliable auto-posting by third-party tools, so we prepare the post and remind you — no false promises.
          </p>

          <SubmitButton className="btn" savedLabel="✓ Scheduled" style={{ marginTop: 12 }}>⏰ Schedule post</SubmitButton>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
            Posts go out within ~10 minutes of the chosen time. Big WhatsApp campaigns send in batches of 400
            every 10 minutes until everyone is covered.
          </p>
        </form>
      </div>

      {/* Upcoming */}
      <h3 style={{ margin: "22px 0 8px" }}>⏳ Upcoming ({pending.length})</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {pending.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing scheduled.</p></div>}
        {pending.map((p) => (
          <div className="list-row" key={p.id} style={{ flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="row-title" style={{ whiteSpace: "pre-wrap" }}>{p.body.length > 140 ? p.body.slice(0, 140) + "…" : p.body}</span>
              <p className="row-sub">
                {p.created_by === "autopilot" ? "🤖 autopilot · " : p.created_by === "pack" ? "✨ pack · " : ""}
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
              <summary style={{ cursor: "pointer", fontSize: ".8rem", color: "var(--accent)" }}>✏️ Edit this post</summary>
              <form action={updatePost} style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                <input type="hidden" name="id" value={p.id} />
                <label>Message (Telegram / WhatsApp / Discord)</label>
                <textarea name="body" rows={3} defaultValue={p.body} required />
                {p.to_instagram && (<><label style={{ marginTop: 6 }}>📷 Instagram caption</label><textarea name="ig_text" rows={3} defaultValue={p.ig_text ?? ""} /></>)}
                {p.to_youtube && (<><label style={{ marginTop: 6 }}>▶️ YouTube community text</label><textarea name="yt_text" rows={2} defaultValue={p.yt_text ?? ""} /></>)}
                {!p.to_instagram && <input type="hidden" name="ig_text" value={p.ig_text ?? ""} />}
                {!p.to_youtube && <input type="hidden" name="yt_text" value={p.yt_text ?? ""} />}
                <div style={{ maxWidth: 260, marginTop: 6 }}>
                  <label>Post at (IST)</label>
                  <input type="datetime-local" name="send_at" defaultValue={istInput(p.send_at)} />
                </div>
                <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save changes</SubmitButton>
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
