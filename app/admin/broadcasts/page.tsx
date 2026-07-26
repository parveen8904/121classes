import AdminHero from "../_components/AdminHero";
import ToggleAllChannels from "./_components/ToggleAllChannels";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../_components/DeleteButton";
import { createServiceClient } from "@/lib/supabase/service";
import { deletePost, sendPostNow, updatePost, saveMarketingSettings, saveScenario } from "./actions";
import { loadBrief } from "@/lib/marketingBrief";
import { SUPPLEMENT_UNTIL, loadFestivalDays } from "@/lib/festivals";

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
  ig_text: string | null; yt_text: string | null; x_text: string | null; created_by: string | null;
  source_kind: string | null; source_label: string | null; source_url: string | null;
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

// Every channel a post can go to — one list, used by the compose form and by
// each post's own edit form so a post can be re-routed after it was written.
const CHANNEL_BOXES: { name: string; label: string; auto: boolean }[] = [
  { name: "to_tg_channel", label: "✈️ Telegram channel", auto: true },
  { name: "to_tg_groups", label: "👥 Subject Telegram groups", auto: true },
  { name: "to_discord", label: "🎮 Discord", auto: true },
  { name: "to_direct", label: "📩 Direct to every connected student", auto: true },
  { name: "to_whatsapp", label: "💬 WhatsApp (every student + lead)", auto: true },
  { name: "to_instagram", label: "📷 Instagram", auto: false },
  { name: "to_youtube", label: "▶️ YouTube community post", auto: false },
  { name: "to_yt_video", label: "🎥 YouTube video brief", auto: false },
  { name: "to_twitter", label: "🐦 Twitter/X", auto: false },
  { name: "to_linkedin", label: "💼 LinkedIn", auto: false },
  { name: "to_facebook", label: "📘 Facebook page", auto: false },
  { name: "to_reddit", label: "👽 Reddit", auto: false },
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

export default async function BroadcastsPage(props: { searchParams: Promise<{ pack?: string; made?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const brief = await loadBrief(svc);
  // Why the last pack attempt failed, in words rather than a guess at the key.
  const { data: packErrRow } = await svc.from("site_settings").select("value").eq("key", "pack_last_error").maybeSingle();
  let packError: { reason?: string; sample?: string } | null = null;
  try { packError = packErrRow?.value ? JSON.parse(String(packErrRow.value)) : null; } catch { packError = null; }
  // A one-line state of the festival list; the choosing happens on its own page.
  const chosenFestivals = (await loadFestivalDays(
    svc,
    new Date().toISOString().slice(0, 10),
    new Date(Date.now() + 400 * 86400e3).toISOString().slice(0, 10),
  )).filter((f) => f.greet);
  const festivalCount = chosenFestivals.length;
  const nextFestival = chosenFestivals[0]
    ? `${chosenFestivals[0].name}, ${new Date(`${chosenFestivals[0].on_date}T06:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "long" })}`
    : null;
  const supplementLapsed = SUPPLEMENT_UNTIL < new Date().toISOString().slice(0, 10);
  const { data } = await svc
    .from("scheduled_posts")
    .select("*")
    .order("send_at", { ascending: false })
    .limit(60);
  const posts = (data ?? []) as Post[];
  const { data: audData } = await svc.rpc("admin_dm_audience");
  const audience = (audData ?? []) as Audience[];
  const { data: settingRows } = await svc.from("site_settings").select("key, value").eq("key", "marketing_poster_emails");
  const posterEmails = (settingRows ?? [])[0]?.value as string ?? "";
  const pending = posts.filter((p) => p.status === "pending").sort((a, b) => a.send_at.localeCompare(b.send_at));
  const done = posts.filter((p) => p.status !== "pending");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📣 Campaigns"
        title="Posts, autopilot & settings"
        subtitle="The situation your students are in, who gets the pasting reminders, and every post scheduled or sent. Campaigns are created in one place: Marketing → Start a campaign. ⏰"
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="card" style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: 1, fontSize: ".85rem" }}>
          <strong>Making something new?</strong> Everything — a news item, an article, an event, a greeting, or your
          own words untouched — is created in one place now, in three steps.
        </div>
        <a className="btn" href="/admin/campaigns/new">✨ Start a campaign</a>
      </div>

      {searchParams.made && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✨ Written — <strong>{searchParams.made} post(s)</strong> from what you chose, waiting below. Read them, change
          anything, delete what you don&apos;t want.
        </div>
      )}
      {searchParams.pack && searchParams.pack !== "fail" && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✨ Pack ready — <strong>{searchParams.pack} posts</strong> written and scheduled below. Read them, edit or delete any you don&apos;t like; the rest go out on time.
        </div>
      )}
      {searchParams.pack === "fail" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          <strong>Couldn&apos;t generate the pack.</strong>{" "}
          {packError?.reason
            ? <>What actually went wrong: <em>{packError.reason}</em>.{" "}
                {packError.reason.includes("call itself")
                  ? <>So check the Anthropic key on Integrations and that &ldquo;Marketing pack generator&rdquo; is on in Admin → AI usage.</>
                  : <>The key is fine — the AI answered, but not in the form we can use. Try once more; if it keeps happening, tell the developer this: <code style={{ fontSize: ".72rem" }}>{packError.sample?.slice(0, 160)}</code></>}
              </>
            : <>Check the Anthropic key on Integrations and that &ldquo;Marketing pack generator&rdquo; is on in Admin → AI usage.</>}
        </div>
      )}

      {/* What is going on right now — read before every post is written */}
      <div className="form-card" style={{ marginTop: 16, borderLeft: "3px solid var(--accent)" }}>
        <h3 style={{ marginTop: 0 }}>📌 What is going on right now</h3>
        <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 12px" }}>
          Every post — autopilot or pack — is written against these four notes. Keep them current and the writing
          stays true to the month: no exam-eve talk in July, no telling students to revise when they are still
          reading the syllabus for the first time. Plain sentences are enough.
        </p>
        <form action={saveScenario}>
          <label>Which attempt are they preparing for?</label>
          <input name="attempt" defaultValue={brief.attempt} placeholder="e.g. September 2026 attempt (CA Final &amp; Inter)" />

          <label style={{ marginTop: 10 }}>Where are the students right now? <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}>— the most important box</span></label>
          <textarea name="stage" rows={4} defaultValue={brief.stage}
            placeholder={"e.g. Two months to go. Most students are in their first exhaustive study of the syllabus — reading chapters properly for the first time, not revising.\nA smaller group who took the classes earlier are on their first revision.\nNobody is in exam mode yet, so no last-minute or exam-eve talk."} />

          <div className="card" style={{ marginTop: 12, fontSize: ".82rem" }}>
            🎉 <strong>Festival greetings</strong> — {festivalCount > 0
              ? <>{festivalCount} day(s) picked for the year ahead{nextFestival ? <>, next: <strong>{nextFestival}</strong></> : null}.</>
              : <>not set up yet — the calendar has not been imported.</>}{" "}
            Choose which days are worth a wish, which are big enough to take over every account, rename anything,
            or add your own on the <a href="/admin/broadcasts/festivals"><strong>Festival greetings</strong></a> page.
            {supplementLapsed && (
              <div className="notice err" style={{ marginTop: 8 }}>
                ⚠️ Guru Purnima is in no public calendar, so we keep its dates ourselves — and that list has now run
                out. Add the next one on the Festival greetings page.
              </div>
            )}
          </div>
          <input type="hidden" name="festivals" value={brief.festivals} />

          <div className="notice ok" style={{ marginTop: 12, fontSize: ".82rem" }}>
            📰 <strong>Profession news is pulled in on its own.</strong> ICAI, NFRA, MCA, RBI, SEBI, NCLT, SFIO and
            IFRS headlines arrive hourly in <a href="/admin/announcements">Announcements</a>, and the last month of
            them is handed to the writer — <strong>no approval needed</strong>. That feed is raw material for both
            things; ticking &ldquo;Published&rdquo; there decides only what <em>students</em> see on the site.
            Headlines only: nothing beyond what a headline says is ever stated.
          </div>
          <label style={{ marginTop: 10 }}>Anything else going on that posts should build on? <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}>— optional</span></label>
          <textarea name="news" rows={2} defaultValue={brief.news}
            placeholder={"e.g. a standard newly applicable for this attempt that students are anxious about"} />

          <SubmitButton className="btn" savedLabel="✓ Saved" style={{ marginTop: 12 }}>Save the situation</SubmitButton>
        </form>
      </div>

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
              <form action={updatePost} style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
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

                <label style={{ marginTop: 10 }}>📷 Instagram caption <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem" }}>— blank = use the message above</span></label>
                <textarea name="ig_text" rows={3} defaultValue={p.ig_text ?? ""} />
                <label style={{ marginTop: 8 }}>▶️ YouTube community text</label>
                <textarea name="yt_text" rows={2} defaultValue={p.yt_text ?? ""} />
                <label style={{ marginTop: 8 }}>🐦 Twitter/X post <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem" }}>— keep it under 280 characters</span></label>
                <textarea name="x_text" rows={2} defaultValue={p.x_text ?? ""} />

                <label style={{ marginTop: 10 }}>Where this one post goes</label>
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
