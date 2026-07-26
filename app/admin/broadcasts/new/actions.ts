"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../../_lib/util";
import { CHANNELS, type ChannelKey } from "@/lib/marketingRhythm";
import { autoBriefParts, briefText, loadBrief } from "@/lib/marketingBrief";
import { generateSourcedCampaign, type SourceKind } from "@/lib/ai";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// The checkbox the founder ticks → the channel whose voice we write in. The
// rooms that carry the plain message (subject groups, direct, WhatsApp) share
// the community voice rather than getting an invented one.
const FIELD_TO_VOICE: Record<string, ChannelKey> = {
  to_tg_channel: "community", to_tg_groups: "community", to_discord: "community",
  to_direct: "community", to_whatsapp: "community",
  to_instagram: "instagram", to_youtube: "youtube_community", to_yt_video: "youtube_video",
  to_twitter: "twitter", to_linkedin: "linkedin", to_facebook: "facebook",
  to_reddit: "reddit", to_substack: "substack", to_medium: "medium",
  to_quora: "quora", to_google: "google",
};

const ALL_FLAGS = Object.fromEntries(Object.keys(FIELD_TO_VOICE).map((f) => [f, false]));

// One campaign, written about one chosen thing, as one post per channel so
// each can be edited or dropped on its own.
export async function createCampaign(formData: FormData) {
  if (!(await requireAdmin())) return;
  const kind = (str(formData.get("kind")) || "idea") as SourceKind;
  const svc = createServiceClient();

  // For a news campaign the truth comes from the chosen row itself, not from
  // whatever the form happened to be showing — the writer must never be handed
  // one headline with another item's facts under it.
  let title = str(formData.get("title")).trim();
  let url: string | null = str(formData.get("source_url")).trim() || null;
  let sourceBody = "";
  const pick = str(formData.get("pick")).trim();
  if (kind === "news") {
    if (!pick) redirect("/admin/broadcasts/new?kind=news&err=notitle");
    const { data: a } = await svc.from("announcements").select("title, body, link_url").eq("id", pick).maybeSingle();
    if (!a) redirect("/admin/broadcasts/new?kind=news&err=notitle");
    title = String(a!.title ?? "").trim();
    url = (a!.link_url as string | null) || null;
    sourceBody = String(a!.body ?? "").trim();
  }
  const notes = str(formData.get("notes")).trim();
  const typed = str(formData.get("detail")).trim();
  const detail = [sourceBody, typed, notes].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join("\n\n");
  if (!title) redirect(`/admin/broadcasts/new?kind=${kind}&err=notitle`);

  // Which channels, and in whose voice.
  const fields = Object.keys(FIELD_TO_VOICE).filter((f) => formData.get(f) === "on");
  if (!fields.length) redirect(`/admin/broadcasts/new?kind=${kind}&err=nochannel`);
  const voices = [...new Set(fields.map((f) => FIELD_TO_VOICE[f]))];
  const channels = voices.map((key) => {
    const c = CHANNELS.find((x) => x.key === key)!;
    return { key: c.key, label: c.label, brief: c.brief, maxChars: c.maxChars };
  });

  const scenario = briefText(await loadBrief(svc), await autoBriefParts(svc));
  const written = await generateSourcedCampaign({
    kind,
    title,
    detail,
    url,
    channels,
    scenario,
    // A greeting sells nothing, ever. Everything else may carry one quiet line.
    mention: kind === "greeting" ? null : (str(formData.get("mention")).trim() || null),
  });
  if (!written) redirect(`/admin/broadcasts/new?kind=${kind}&err=ai`);

  // When it goes out.
  const when = str(formData.get("send_at"));
  const now = formData.get("now") === "on";
  const at = now
    ? new Date(Date.now() - 1000)
    : when
      ? new Date(new Date(`${when}:00Z`).getTime() - (5 * 60 + 30) * 60 * 1000)
      : new Date(Date.now() + 3600e3);

  // One row per ticked channel, carrying that channel's own words — so each
  // can be read, edited or dropped on its own.
  const rows = fields.map((field) => {
    const voice = FIELD_TO_VOICE[field];
    const body = written.posts[voice] ?? Object.values(written.posts)[0];
    return {
      ...ALL_FLAGS,
      [field]: true,
      body,
      campaign: written.focus.slice(0, 120),
      send_at: at.toISOString(),
      ig_text: voice === "instagram" ? body : null,
      yt_text: voice === "youtube_community" ? body : null,
      x_text: voice === "twitter" ? body : null,
      wa_template: str(formData.get("wa_template")) || null,
      source_kind: kind,
      source_label: title.slice(0, 200),
      source_url: url,
      created_by: "campaign",
    };
  });

  await svc.from("scheduled_posts").insert(rows);
  revalidatePath("/admin/broadcasts");
  redirect(`/admin/broadcasts?made=${rows.length}`);
}

// Best effort: pull the story behind a headline so the writer has more than a
// title to work from. Google News links redirect and some sites refuse bots,
// so this is allowed to fail — he can always paste the detail himself.
export async function fetchStory(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("announcement_id"));
  const url = str(formData.get("url"));
  if (!id || !url) return;
  let extracted = "";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CAParveenSharmaBot/1.0; +https://caparveensharma.com)" },
    });
    if (res.ok) {
      const html = await res.text();
      extracted = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2500);
    }
  } catch { /* leave it empty — the form says so */ }
  redirect(`/admin/broadcasts/new?kind=news&pick=${id}&story=${encodeURIComponent(extracted ? "ok" : "fail")}${extracted ? `&text=${encodeURIComponent(extracted.slice(0, 1800))}` : ""}`);
}
