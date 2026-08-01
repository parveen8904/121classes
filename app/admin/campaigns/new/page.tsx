import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import ToggleAllChannels from "../../broadcasts/_components/ToggleAllChannels";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFestivalDays } from "@/lib/festivals";
import { SOFT_MENTIONS } from "@/lib/marketingRhythm";
import { loadBrief } from "@/lib/marketingBrief";
import { draftCampaign } from "../actions";
import { FIELD_LABEL } from "@/lib/campaignChannels";
import { channelStatus, STATE_ICON, STATE_WORD } from "@/lib/channelStatus";
import ChannelFolders, { type Folder } from "../../broadcasts/ChannelFolders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Start a campaign — Admin" };

// Step 1 of 3. Name it, say what it is about, who it is for, what may be
// mentioned, and where it goes. Nothing is scheduled here — the next screen
// shows every post for reading and editing first.

type Row = { id: string; title: string; body?: string | null; link_url?: string | null; kind?: string; published_at?: string; story_at?: string | null; slug?: string; description?: string | null; created_at?: string };

// Two different dates, and the difference matters: when the story was
// published, and when our feed picked it up.
const dayFmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "");

const KINDS = [
  { key: "news", icon: "📰", label: "Something in the news", hint: "Pick one item your feed brought in — ICAI, NFRA, MCA, RBI, SEBI, NCLT." },
  { key: "article", icon: "📝", label: "An article we published", hint: "Turn one of your own articles into posts, and send readers to it." },
  { key: "event", icon: "📅", label: "An event of ours", hint: "A live class, a new batch, a result — anything happening here." },
  { key: "greeting", icon: "🎉", label: "A greeting", hint: "A festival or a day worth wishing students on." },
  { key: "idea", icon: "💡", label: "A thought worth sharing", hint: "A concept, a common mistake, something you want said — the writer puts it into each platform's voice." },
  { key: "own", icon: "✍️", label: "My own words, untouched", hint: "You type it, it goes out exactly as typed. Nothing is rewritten by anyone." },
];

const AUDIENCES = [
  "Everyone — CA Foundation, Inter and Final",
  "Students in their first exhaustive study of the syllabus",
  "Students who have finished once and are now revising",
  "Students who are behind schedule and worried",
  "CA Final students (Financial Reporting)",
  "CA Inter students (Advanced Accounting)",
  "Students who have not started with us yet",
];

const CHANNEL_FIELDS = Object.keys(FIELD_LABEL);
const ERRORS: Record<string, string> = {
  nopick: "Choose the exact item first.",
  notitle: "Say what the campaign is about.",
  nochannel: "Tick at least one place for it to go.",
  ai: "The writer couldn't produce it — try again; the reason is recorded on the campaigns list.",
};

const istDate = (s?: string) => (s ? new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "");

export default async function NewCampaignPage(props: { searchParams: Promise<{ kind?: string; pick?: string; err?: string }> }) {
  const sp = await props.searchParams;
  const kind = KINDS.some((k) => k.key === sp.kind) ? sp.kind! : "news";
  const svc = createServiceClient();

  const [{ data: news }, { data: articles }, festivals, brief, status] = await Promise.all([
    kind === "news" ? svc.from("announcements").select("id, title, body, link_url, kind, published_at, story_at, created_at").order("published_at", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    kind === "article" ? svc.from("articles").select("id, title, slug, description, created_at").eq("is_published", true).order("created_at", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    loadFestivalDays(svc, new Date().toISOString().slice(0, 10), new Date(Date.now() + 120 * 86400e3).toISOString().slice(0, 10)),
    loadBrief(svc),
    channelStatus(),
  ]);
  const { data: folderRows } = await svc.from("channel_folders").select("id, name, icon, channels").order("sort").order("name");
  const folders = (folderRows ?? []) as Folder[];
  const items = ((kind === "news" ? news : articles) ?? []) as Row[];
  const picked = items.find((a) => a.id === sp.pick);
  const step = { margin: "22px 0 8px", fontSize: "1.02rem" } as const;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="✨ Step 1 of 3"
        title="Start a campaign"
        subtitle="Name it, choose what it is about and who it is for. Next you'll read every post before anything is scheduled. 📝"
        back={{ href: "/admin/campaigns", label: "Marketing" }}
      />

      {sp.err && <div className="notice err" style={{ marginTop: 16 }}>{ERRORS[sp.err] ?? "Something was missing."}</div>}

      {/* Reason chooser sits outside the form — it navigates */}
      <h3 style={step}>1. What is this campaign about?</h3>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {KINDS.map((k) => (
          <a key={k.key} href={`/admin/campaigns/new?kind=${k.key}`} className={kind === k.key ? "btn small" : "btn small secondary"} style={{ textAlign: "left" }}>
            {k.icon} {k.label}
          </a>
        ))}
      </div>
      <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>{KINDS.find((k) => k.key === kind)!.hint}</p>

      <form id="newcampaign" action={draftCampaign}>
        <input type="hidden" name="kind" value={kind} />

        <h3 style={step}>2. Which one exactly?</h3>
        <div className="form-card">
          {(kind === "news" || kind === "article") && (
            <>
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 4 }}>
                {items.length === 0 && (
                  <p className="muted" style={{ fontSize: ".85rem", margin: 8 }}>
                    {kind === "news"
                      ? "Nothing in the feed — fetch news on Admin → Announcements first."
                      : "No published articles yet."}
                  </p>
                )}
                {items.map((a) => (
                  <a key={a.id} href={`/admin/campaigns/new?kind=${kind}&pick=${a.id}`}
                    style={{
                      display: "block", padding: "7px 8px", fontSize: ".85rem", textDecoration: "none",
                      borderBottom: "1px solid var(--border)", borderRadius: 6,
                      background: sp.pick === a.id ? "var(--accent)" : "transparent",
                      color: sp.pick === a.id ? "#fff" : "inherit",
                    }}>
                    {sp.pick === a.id ? "✓ " : ""}<strong>{a.title}</strong>
                    <span style={{ fontSize: ".74rem", opacity: 0.75, display: "block", marginTop: 2 }}>
                      {kind === "news"
                        ? <>{a.story_at ? `published ${dayFmt(a.story_at)}` : "publish date unknown"} · picked up by us {dayFmt(a.created_at)}</>
                        : <>published {dayFmt(a.created_at)}</>}
                    </span>
                  </a>
                ))}
              </div>
              <input type="hidden" name="pick" value={picked?.id ?? ""} />
              {picked && (
                <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>
                  Chosen: <strong>{picked.title}</strong>
                  {picked.link_url ? <> · <a href={picked.link_url} target="_blank" rel="noopener noreferrer">open ↗</a></> : null}
                </p>
              )}
            </>
          )}

          {kind === "greeting" && (
            <div style={{ display: "grid", gap: 4, maxHeight: 240, overflowY: "auto" }}>
              {festivals.map((f) => (
                <label key={f.id} className="remember" style={{ margin: 0, fontSize: ".85rem" }}>
                  <input type="radio" name="title" value={f.name} required /> {f.name}
                  <span className="muted" style={{ fontSize: ".76rem" }}> · {istDate(`${f.on_date}T06:00:00Z`)}</span>
                </label>
              ))}
              {festivals.length === 0 && <p className="muted" style={{ fontSize: ".85rem" }}>Your festival list is empty.</p>}
            </div>
          )}

          {kind === "own" && (
            <>
              <label>Your message — exactly as it should go out</label>
              <textarea name="title" rows={5} required
                placeholder={"Wishing every student and every teacher a very happy Guru Purnima.\n\nWhatever you know today, someone sat down and explained it to you first."} />
              <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0" }}>
                Every channel starts with this text. On the next screen you can change it for any one of them.
              </p>
            </>
          )}

          {(kind === "event" || kind === "idea") && (
            <>
              <label>{kind === "event" ? "What is happening?" : "What do you want said?"}</label>
              <input name="title" required
                placeholder={kind === "event" ? "e.g. Live revision class on Ind AS 115, Sunday 6 pm" : "e.g. Why students lose marks in consolidation even when the logic is right"} />
            </>
          )}

          <label style={{ marginTop: 12 }}>
            What the writer may treat as fact
            <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}> — it may not state anything beyond this</span>
          </label>
          <textarea name="detail" rows={5} defaultValue={picked?.body ?? picked?.description ?? ""}
            placeholder="Paste or type what is actually known." />
        </div>

        <h3 style={step}>3. Who is it for?</h3>
        <div className="form-card">
          <select name="audience" defaultValue={AUDIENCES[0]}>
            {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0 0" }}>
            Where your students are right now is already known to the writer:{" "}
            <em>{(brief.stage || "not set — fill it in on the Situation card").slice(0, 160)}…</em>{" "}
            <Link href="/admin/broadcasts">change it</Link>
          </p>
        </div>

        <h3 style={step}>4. Anything you want to add, and what may be mentioned</h3>
        <div className="form-card">
          <label>Your own words <span className="muted" style={{ fontWeight: 400, fontSize: ".78rem" }}>— your angle, what students should take from it</span></label>
          <textarea name="notes" rows={3} placeholder="e.g. Point out this is examinable in September and where it sits in the syllabus." />
          <label style={{ marginTop: 10 }}>The one quiet mention</label>
          <select name="mention" defaultValue="">
            <option value="">No mention — this one only informs</option>
            {SOFT_MENTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="muted" style={{ fontSize: ".76rem", margin: "4px 0 0" }}>
            One line, in one of the posts, at the end. Greetings never carry one whatever is chosen.
          </p>
        </div>

        <h3 style={step}>5. Where should it go, and when?</h3>
        <div className="form-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ margin: 0 }}>Name this campaign</label>
            <ToggleAllChannels />
          </div>
          {/* Your own folders — one click ticks that whole set. */}
          <div style={{ marginTop: 8 }}>
            <ChannelFolders folders={folders} formId="newcampaign" />
          </div>
          <input name="name" placeholder="e.g. NFRA audit-quality circular — September batch" style={{ marginTop: 4 }} />
          <div style={{ display: "grid", gap: 5, gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
            {CHANNEL_FIELDS.map((f) => {
              const s = status[f];
              return (
                <label key={f} className="remember" style={{ margin: 0, fontSize: ".85rem" }} title={s?.note}>
                  <input type="checkbox" name={f} defaultChecked={f === "to_tg_channel"} /> {FIELD_LABEL[f]}{" "}
                  <span style={{ fontSize: ".72rem", opacity: 0.8 }}>{STATE_ICON[s?.state ?? "manual"]} {STATE_WORD[s?.state ?? "manual"]}</span>
                </label>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>
            Each place gets its own version, written for it. ✅ publishes on its own · ⚠️ would publish on its own but
            its keys are not saved, so it is emailed to you instead · ✋ has no posting API at all and always needs a
            person. <strong>WhatsApp is never included by &ldquo;All channels&rdquo;</strong> — it costs per message and
            reaches every contact you have, so tick it deliberately (and give the template name below).
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
            <div>
              <label style={{ fontSize: ".8rem" }}>When (IST) — you can change it later</label>
              <input type="datetime-local" name="send_at" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: ".8rem" }}>WhatsApp template (only if WhatsApp is ticked)</label>
              <input name="wa_template" placeholder="e.g. marketing_update" />
            </div>
          </div>
          <SubmitButton className="btn" savedLabel="✓ Written" style={{ marginTop: 14 }}>Write the posts →</SubmitButton>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
            Nothing is scheduled yet. The next screen shows every post for you to read, edit or drop.
          </p>
        </div>
      </form>
    </section>
  );
}
