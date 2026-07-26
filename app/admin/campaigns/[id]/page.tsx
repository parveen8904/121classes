import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteDraftPost, saveDraftPost, scheduleCampaign, markTeamDone } from "../actions";
import { AUTO_FIELDS, FIELD_LABEL } from "@/lib/campaignChannels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign — Admin" };

// Steps 2 and 3. While the posts are drafts this is the reading-and-editing
// screen; once scheduled it becomes the record of the campaign, including the
// list of things only a person can do.

type Post = {
  id: string; body: string; campaign: string | null; status: string; send_at: string;
  source_kind: string | null; source_label: string | null; source_url: string | null;
  team_done_at: string | null; sent_at: string | null; status_note: string | null;
} & Record<string, unknown>;

const istFmt = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const istInput = (s: string) => new Date(new Date(s).getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 16);
const fieldOf = (p: Post) => Object.keys(FIELD_LABEL).find((f) => p[f] === true) ?? "";

export default async function CampaignPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scheduled?: string }>;
}) {
  const { id } = await props.params;
  const { scheduled } = await props.searchParams;
  const svc = createServiceClient();
  const { data } = await svc.from("scheduled_posts").select("*").eq("campaign_id", id).order("send_at");
  const posts = (data ?? []) as Post[];

  if (!posts.length) {
    return (
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
        <AdminHero badge="✨ Campaign" title="Campaign" subtitle="Nothing here." back={{ href: "/admin/campaigns", label: "Marketing" }} />
        <div className="notice err" style={{ marginTop: 16 }}>This campaign has no posts — it may have been deleted.</div>
      </section>
    );
  }

  const isDraft = posts.some((p) => p.status === "draft");
  const first = posts[0];
  const teamJobs = posts.filter((p) => !AUTO_FIELDS.has(fieldOf(p)));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge={isDraft ? "✨ Step 2 of 3" : "✅ Campaign scheduled"}
        title={first.campaign || "Campaign"}
        subtitle={isDraft
          ? "Read every post. Change anything you don't like, drop what you don't want, then schedule the rest. 👀"
          : "Scheduled. Anything a machine can post, it will. The rest is listed below for your team. 📋"}
        back={{ href: "/admin/campaigns", label: "Marketing" }}
      />

      {scheduled && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Scheduled. Telegram, Discord, WhatsApp — and LinkedIn, X, Facebook, Reddit and Instagram where their keys
          are set — go out on their own. The rest is your team&apos;s list below.
        </div>
      )}

      <div className="card" style={{ marginTop: 16, fontSize: ".85rem" }}>
        <strong>Why this campaign exists:</strong>{" "}
        {first.source_kind === "news" ? "📰 news" : first.source_kind === "article" ? "📝 an article" : first.source_kind === "greeting" ? "🎉 a greeting" : first.source_kind === "event" ? "📅 an event" : "💡 an idea"}
        {first.source_label ? <> — {first.source_url ? <a href={first.source_url} target="_blank" rel="noopener noreferrer">{first.source_label}</a> : first.source_label}</> : null}
      </div>

      {/* The posts */}
      <h3 style={{ margin: "22px 0 8px" }}>{posts.length} post{posts.length === 1 ? "" : "s"}</h3>
      <div style={{ display: "grid", gap: 10 }}>
        {posts.map((p) => {
          const field = fieldOf(p);
          return (
            <div className="form-card" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>{FIELD_LABEL[field] ?? "Post"}</strong>
                <span className="muted" style={{ fontSize: ".78rem" }}>
                  {AUTO_FIELDS.has(field) ? "posts by itself" : "✋ a person must post this"} · {istFmt(p.send_at)} IST
                  {p.status === "sent" ? " · ✅ sent" : ""}
                </span>
              </div>
              {isDraft ? (
                <form action={saveDraftPost} style={{ marginTop: 8 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="campaign_id" value={id} />
                  <textarea name="body" rows={Math.min(10, Math.max(3, Math.ceil(p.body.length / 90)))} defaultValue={p.body} />
                  {/* Two actions, one form — a form inside a form is not valid HTML */}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <SubmitButton className="btn small" savedLabel="✓ Saved">Save this one</SubmitButton>
                    <button type="submit" className="btn small secondary" formAction={deleteDraftPost}>Drop it</button>
                  </div>
                </form>
              ) : (
                <div style={{ whiteSpace: "pre-wrap", fontSize: ".9rem", marginTop: 8 }}>{p.body}</div>
              )}
              {p.status_note ? <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>{p.status_note}</p> : null}
            </div>
          );
        })}
      </div>

      {/* Step 3: schedule */}
      {isDraft && (
        <div className="form-card" style={{ marginTop: 18, borderLeft: "3px solid var(--accent)" }}>
          <strong>Step 3 — happy with them?</strong>
          <form action={scheduleCampaign} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
            <input type="hidden" name="campaign_id" value={id} />
            <div>
              <label style={{ fontSize: ".8rem" }}>Go out at (IST)</label>
              <input type="datetime-local" name="send_at" defaultValue={istInput(first.send_at)} />
            </div>
            <label className="remember" style={{ margin: "0 0 8px" }}><input type="checkbox" name="now" /> Send now instead</label>
            <SubmitButton className="btn" savedLabel="✓ Scheduled" style={{ marginBottom: 2 }}>Schedule this campaign</SubmitButton>
          </form>
          <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>
            Until you press this, nothing goes anywhere.
          </p>
        </div>
      )}

      {/* What the team has to do by hand */}
      {!isDraft && teamJobs.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 8px" }}>📋 For the team — {teamJobs.filter((p) => !p.team_done_at).length} left to post by hand</h3>
          <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
            These places have no way for an outside tool to post to them. The text arrives by email at the scheduled
            time too — tick each one off here once it is up.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {teamJobs.map((p) => (
              <div className="list-row" key={p.id} style={{ opacity: p.team_done_at ? 0.55 : 1 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="row-title">{p.team_done_at ? "✅ " : "⬜ "}{FIELD_LABEL[fieldOf(p)]}</span>
                  <p className="row-sub" style={{ whiteSpace: "pre-wrap" }}>{p.body.slice(0, 180)}{p.body.length > 180 ? "…" : ""}</p>
                </div>
                <div className="row-actions">
                  {!p.team_done_at && (
                    <form action={markTeamDone}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton className="btn small" savedLabel="✓ Done">Mark done</SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
