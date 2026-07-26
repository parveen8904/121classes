"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";
import { CHANNELS } from "@/lib/marketingRhythm";
import { ALL_CHANNEL_FLAGS, FIELD_TO_VOICE } from "@/lib/campaignChannels";
import { autoBriefParts, briefText, loadBrief } from "@/lib/marketingBrief";
import { generateSourcedCampaign, type SourceKind } from "@/lib/ai";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Step 1 → 2. Writes the posts as DRAFTS: nothing can go out until he has read
// them and pressed schedule.
export async function draftCampaign(formData: FormData) {
  if (!(await requireAdmin())) return;
  const kind = (str(formData.get("kind")) || "idea") as SourceKind;
  const name = str(formData.get("name")).trim();
  const svc = createServiceClient();
  const back = (err: string) => `/admin/campaigns/new?kind=${kind}&err=${err}`;

  // What it is about — for news and articles the facts come from the stored
  // row itself, never from whatever the form happened to be showing.
  let title = str(formData.get("title")).trim();
  let url: string | null = null;
  let sourceBody = "";
  const pick = str(formData.get("pick")).trim();
  if (kind === "news") {
    if (!pick) redirect(back("nopick"));
    const { data: a } = await svc.from("announcements").select("title, body, link_url").eq("id", pick).maybeSingle();
    if (!a) redirect(back("nopick"));
    title = String(a!.title ?? "").trim();
    url = (a!.link_url as string | null) || null;
    sourceBody = String(a!.body ?? "").trim();
  } else if (kind === "article") {
    if (!pick) redirect(back("nopick"));
    const { data: art } = await svc.from("articles").select("title, slug, description").eq("id", pick).maybeSingle();
    if (!art) redirect(back("nopick"));
    title = String(art!.title ?? "").trim();
    url = `https://caparveensharma.com/articles/${String(art!.slug)}?src=social`;
    sourceBody = String(art!.description ?? "").trim();
  }
  if (!title) redirect(back("notitle"));

  const detail = [sourceBody, str(formData.get("detail")).trim(), str(formData.get("notes")).trim()]
    .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join("\n\n");

  const fields = Object.keys(FIELD_TO_VOICE).filter((f) => formData.get(f) === "on");
  if (!fields.length) redirect(back("nochannel"));
  const voices = [...new Set(fields.map((f) => FIELD_TO_VOICE[f]))];
  const channels = voices.map((key) => {
    const c = CHANNELS.find((x) => x.key === key)!;
    return { key: c.key, label: c.label, brief: c.brief, maxChars: c.maxChars };
  });

  // His own words are never handed to the writer: every channel gets exactly
  // what he typed, and step 2 is where he tailors any of them by hand.
  const written = kind === "own"
    ? { focus: title.slice(0, 60), posts: Object.fromEntries(channels.map((c) => [c.key, title])) }
    : await generateSourcedCampaign({
        kind, title, detail, url,
        audience: str(formData.get("audience")).trim() || null,
        channels,
        scenario: briefText(await loadBrief(svc), await autoBriefParts(svc)),
        mention: kind === "greeting" ? null : (str(formData.get("mention")).trim() || null),
      });
  if (!written) redirect(back("ai"));

  const when = str(formData.get("send_at"));
  const at = when
    ? new Date(new Date(`${when}:00Z`).getTime() - (5 * 60 + 30) * 60 * 1000)
    : new Date(Date.now() + 2 * 3600e3);

  const campaignId = randomUUID();
  const rows = fields.map((field) => {
    const voice = FIELD_TO_VOICE[field];
    const body = written!.posts[voice] ?? Object.values(written!.posts)[0];
    return {
      ...ALL_CHANNEL_FLAGS,
      [field]: true,
      body,
      campaign: name || (kind === "own" ? "My own post" : written!.focus.slice(0, 120)),
      campaign_id: campaignId,
      status: "draft",
      send_at: at.toISOString(),
      ig_text: voice === "instagram" ? body : null,
      yt_text: voice === "youtube_community" ? body : null,
      x_text: voice === "twitter" ? body : null,
      wa_template: str(formData.get("wa_template")) || null,
      source_kind: kind,
      source_label: kind === "own" ? (name || "written by you") : title.slice(0, 200),
      source_url: url,
      created_by: "campaign",
    };
  });
  await svc.from("scheduled_posts").insert(rows);
  redirect(`/admin/campaigns/${campaignId}`);
}

// Step 2: edit one draft in place.
export async function saveDraftPost(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const campaignId = str(formData.get("campaign_id"));
  const body = str(formData.get("body"));
  if (!id || !body) return;
  await createServiceClient().from("scheduled_posts").update({ body }).eq("id", id).eq("status", "draft");
  revalidatePath(`/admin/campaigns/${campaignId}`);
}

export async function deleteDraftPost(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const campaignId = str(formData.get("campaign_id"));
  await createServiceClient().from("scheduled_posts").delete().eq("id", id).eq("status", "draft");
  revalidatePath(`/admin/campaigns/${campaignId}`);
}

// Step 3: approve the lot. Drafts become pending and the cron takes them from
// there — auto-posting where a machine can, a job for the team where it can't.
export async function scheduleCampaign(formData: FormData) {
  if (!(await requireAdmin())) return;
  const campaignId = str(formData.get("campaign_id"));
  if (!campaignId) return;
  const when = str(formData.get("send_at"));
  const now = formData.get("now") === "on";
  const patch: Record<string, unknown> = { status: "pending" };
  if (now) patch.send_at = new Date(Date.now() - 1000).toISOString();
  else if (when) patch.send_at = new Date(new Date(`${when}:00Z`).getTime() - (5 * 60 + 30) * 60 * 1000).toISOString();
  await createServiceClient().from("scheduled_posts").update(patch).eq("campaign_id", campaignId).eq("status", "draft");
  revalidatePath("/admin/campaigns");
  redirect(`/admin/campaigns/${campaignId}?scheduled=1`);
}

// The team ticking off a place only a person can post to.
export async function markTeamDone(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("scheduled_posts")
    .update({ team_done_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/campaigns");
}
