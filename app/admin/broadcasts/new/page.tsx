import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import ToggleAllChannels from "../_components/ToggleAllChannels";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFestivalDays } from "@/lib/festivals";
import { SOFT_MENTIONS } from "@/lib/marketingRhythm";
import { createCampaign, fetchStory } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New campaign — Admin" };

// A campaign starts with a REASON the founder picked: this festival, this news
// item, this event, this idea. Everything written is about that one thing.

type Announcement = { id: string; title: string; body: string | null; link_url: string | null; kind: string; published_at: string };

const KINDS = [
  { key: "news", icon: "📰", label: "Something in the news", hint: "An ICAI / NFRA / MCA / RBI / SEBI item from your feed — you choose which one." },
  { key: "greeting", icon: "🎉", label: "A greeting", hint: "A festival or a day worth wishing students on." },
  { key: "event", icon: "📅", label: "An event of ours", hint: "A live class, a new batch, a result, anything happening here." },
  { key: "idea", icon: "💡", label: "A thought worth sharing", hint: "A concept, a mistake students make, something you want said." },
];

const CHANNEL_BOXES = [
  { name: "to_tg_channel", label: "✈️ Telegram channel" },
  { name: "to_discord", label: "🎮 Discord" },
  { name: "to_tg_groups", label: "👥 Subject Telegram groups" },
  { name: "to_direct", label: "📩 Direct to students" },
  { name: "to_instagram", label: "📷 Instagram" },
  { name: "to_facebook", label: "📘 Facebook page" },
  { name: "to_twitter", label: "🐦 Twitter/X" },
  { name: "to_linkedin", label: "💼 LinkedIn" },
  { name: "to_youtube", label: "▶️ YouTube community" },
  { name: "to_yt_video", label: "🎥 YouTube video brief" },
  { name: "to_reddit", label: "👽 Reddit" },
  { name: "to_quora", label: "❓ Quora" },
  { name: "to_substack", label: "📰 Substack" },
  { name: "to_medium", label: "✒️ Medium" },
  { name: "to_google", label: "📍 Google Business Profile" },
  { name: "to_whatsapp", label: "💬 WhatsApp (costs per message)" },
];

const istDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export default async function NewCampaignPage(props: {
  searchParams: Promise<{ kind?: string; pick?: string; err?: string; story?: string; text?: string }>;
}) {
  const sp = await props.searchParams;
  const kind = KINDS.some((k) => k.key === sp.kind) ? sp.kind! : "news";
  const svc = createServiceClient();

  const [{ data: news }, festivals] = await Promise.all([
    svc.from("announcements").select("id, title, body, link_url, kind, published_at")
      .order("published_at", { ascending: false }).limit(60),
    loadFestivalDays(svc, new Date().toISOString().slice(0, 10), new Date(Date.now() + 120 * 86400e3).toISOString().slice(0, 10)),
  ]);
  const items = (news ?? []) as Announcement[];
  const picked = items.find((a) => a.id === sp.pick);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="✨ New campaign"
        title="Build a campaign from something real"
        subtitle="Pick the reason first — a news item, a festival, an event, an idea. Everything written will be about that and nothing else. 🎯"
        back={{ href: "/admin/broadcasts", label: "Campaigns" }}
      />

      {sp.err === "notitle" && <div className="notice err" style={{ marginTop: 16 }}>Pick something to write about first.</div>}
      {sp.err === "nochannel" && <div className="notice err" style={{ marginTop: 16 }}>Tick at least one place for it to go.</div>}
      {sp.err === "ai" && <div className="notice err" style={{ marginTop: 16 }}>The writer couldn&apos;t produce it — try once more; the reason is shown on the Campaigns page.</div>}
      {sp.story === "fail" && <div className="notice err" style={{ marginTop: 16 }}>Couldn&apos;t open that story (the site blocked us, or it needs a subscription). Paste the important parts into the details box yourself.</div>}
      {sp.story === "ok" && <div className="notice ok" style={{ marginTop: 16 }}>Story fetched — check it below, cut anything wrong, then write the campaign.</div>}

      {/* 1. The reason */}
      <div className="card" style={{ marginTop: 16 }}>
        <strong>1. What is this campaign about?</strong>
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 10 }}>
          {KINDS.map((k) => (
            <a key={k.key} href={`/admin/broadcasts/new?kind=${k.key}`}
              className={kind === k.key ? "btn small" : "btn small secondary"}
              style={{ textAlign: "left", lineHeight: 1.3 }}>
              {k.icon} {k.label}
            </a>
          ))}
        </div>
        <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0 0" }}>{KINDS.find((k) => k.key === kind)!.hint}</p>
      </div>

      <form action={createCampaign}>
        <input type="hidden" name="kind" value={kind} />

        {/* 2. The thing itself */}
        <div className="form-card" style={{ marginTop: 14 }}>
          <strong>2. Choose the exact one</strong>

          {kind === "news" && (
            <>
              <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
                The last {items.length} items your feed picked up. Nothing here is written about unless you choose it.
              </p>
              <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 4 }}>
                {items.length === 0 && <p className="muted" style={{ fontSize: ".85rem", margin: 8 }}>The feed is empty — fetch news on Admin → Announcements first.</p>}
                {items.map((a) => (
                  <a key={a.id} href={`/admin/broadcasts/new?kind=news&pick=${a.id}`}
                    style={{
                      display: "block", padding: "7px 8px", fontSize: ".85rem", textDecoration: "none",
                      borderBottom: "1px solid var(--border)", borderRadius: 6,
                      background: sp.pick === a.id ? "var(--accent)" : "transparent",
                      color: sp.pick === a.id ? "#fff" : "inherit",
                    }}>
                    {sp.pick === a.id ? "✓ " : ""}<strong>{a.title}</strong>{" "}
                    <span style={{ fontSize: ".76rem", opacity: 0.75 }}>· {a.kind} · {istDate(a.published_at)}</span>
                  </a>
                ))}
              </div>
              <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>
                Click one — its details load below. Then <strong>Load the details</strong> if you want the full story
                behind the headline.
              </p>
              <input type="hidden" name="pick" value={picked?.id ?? ""} />
            </>
          )}

          {kind === "greeting" && (
            <>
              <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
                Your festival list. (Days you have marked to greet go out on their own too — this is for sending one now
                or wishing on a day that is not in the list.)
              </p>
              <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                {festivals.map((f) => (
                  <label key={f.id} className="remember" style={{ margin: 0, fontSize: ".85rem" }}>
                    <input type="radio" name="title" value={f.name} required /> {f.name}{" "}
                    <span className="muted" style={{ fontSize: ".76rem" }}>· {istDate(`${f.on_date}T06:00:00Z`)}</span>
                  </label>
                ))}
                {festivals.length === 0 && <p className="muted" style={{ fontSize: ".85rem" }}>Nothing in your festival list yet.</p>}
              </div>
            </>
          )}

          {(kind === "event" || kind === "idea") && (
            <>
              <label style={{ marginTop: 8 }}>{kind === "event" ? "What is happening?" : "What do you want said?"}</label>
              <input name="title" required
                placeholder={kind === "event" ? "e.g. Live revision class on Ind AS 115, Sunday 6 pm" : "e.g. Why students lose marks in consolidation even when the logic is right"} />
            </>
          )}

          {/* Details — pre-filled from the chosen news item */}
          <label style={{ marginTop: 12 }}>
            Details the writer may treat as fact
            <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}> — it is forbidden from stating anything beyond this</span>
          </label>
          <textarea name="detail" rows={6} defaultValue={sp.text ?? picked?.body ?? ""}
            placeholder="Paste or type what is actually known. The more you put here, the less the writer has to stay vague." />
          {kind === "news" && (
            <>
              <input type="hidden" name="title" value={picked?.title ?? ""} />
              <input type="hidden" name="source_url" value={picked?.link_url ?? ""} />
              {picked?.link_url && (
                <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0" }}>
                  Chosen: <strong>{picked.title}</strong> · <a href={picked.link_url} target="_blank" rel="noopener noreferrer">open the story ↗</a>
                </p>
              )}
            </>
          )}

          <label style={{ marginTop: 12 }}>Anything you want to add in your own words <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}>— your angle, what students should take from it</span></label>
          <textarea name="notes" rows={3} placeholder="e.g. Point out that this is examinable for the September attempt and where it sits in the syllabus." />

          <label style={{ marginTop: 12 }}>The quiet mention <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}>— one line, in one of the posts, or none at all</span></label>
          <select name="mention" defaultValue="">
            <option value="">No mention — this one only informs</option>
            {SOFT_MENTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="muted" style={{ fontSize: ".76rem", margin: "4px 0 0" }}>
            Greetings never carry one, whatever is chosen here.
          </p>
        </div>

        {/* 3. Where and when */}
        <div className="form-card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong>3. Where should it go, and when?</strong>
            <ToggleAllChannels />
          </div>
          <div style={{ display: "grid", gap: 5, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
            {CHANNEL_BOXES.map((c) => (
              <label key={c.name} className="remember" style={{ margin: 0, fontSize: ".85rem" }}>
                <input type="checkbox" name={c.name} defaultChecked={c.name === "to_tg_channel"} /> {c.label}
              </label>
            ))}
          </div>
          <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>
            Each place gets its own version, written for it — the LinkedIn one will not read like the Instagram one.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
            <div>
              <label style={{ fontSize: ".8rem" }}>When (IST)</label>
              <input type="datetime-local" name="send_at" />
            </div>
            <label className="remember" style={{ margin: "0 0 8px" }}><input type="checkbox" name="now" /> Send it now</label>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: ".8rem" }}>WhatsApp template (only if WhatsApp is ticked)</label>
              <input name="wa_template" placeholder="e.g. marketing_update" />
            </div>
          </div>
          <SubmitButton className="btn" savedLabel="✓ Written" style={{ marginTop: 14 }}>✨ Write this campaign</SubmitButton>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
            Everything lands in &ldquo;Upcoming&rdquo; on the Campaigns page — read each one, edit or delete anything you
            don&apos;t like, and the rest go out at the time you set.
          </p>
        </div>
      </form>

      {/* Load the story behind a headline — separate form so it doesn't submit the campaign */}
      {kind === "news" && (
        <form action={fetchStory} className="card" style={{ marginTop: 14 }}>
          <strong>Need more than the headline?</strong>
          <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 8px" }}>
            Paste the item&apos;s id and link and we&apos;ll try to pull the story text into the details box above. Some
            sites refuse; if so, copy the important paragraphs in yourself.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select name="announcement_id" defaultValue={sp.pick ?? ""} style={{ flex: 2, minWidth: 220 }}>
              <option value="">Choose the item…</option>
              {items.filter((a) => a.link_url).map((a) => <option key={a.id} value={a.id}>{a.title.slice(0, 70)}</option>)}
            </select>
            <input name="url" placeholder="…and paste its link here" defaultValue={picked?.link_url ?? ""} style={{ flex: 3, minWidth: 240 }} />
            <SubmitButton className="btn small secondary">Load the details</SubmitButton>
          </div>
        </form>
      )}
    </section>
  );
}
