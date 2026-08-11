"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ALL_CHANNEL_FLAGS, FIELD_TO_VOICE } from "@/lib/campaignChannels";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

// A RUN OF POSTS TO ONE PLACE, EACH ON ITS OWN DAY.
//
// The campaign wizard writes ONE message and copies it to every channel at a
// single moment. This writes MANY messages to the channels chosen, each with a
// time of its own — a week of X posts rather than one post repeated in seven
// rooms.
//
// They land as drafts, like everything else. The approval step on the campaign
// screen is what sends them, and this deliberately does not bypass it: seven
// posts going out unreviewed is seven times the mistake.
export async function createSeries(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  const channels = formData.getAll("channels").map(String).filter((f) => f in FIELD_TO_VOICE);
  if (!channels.length) redirect("/admin/campaigns/series?err=nochannel");

  const count = Math.min(60, Math.max(1, Number(formData.get("count")) || 0));
  const name = str(formData.get("name")).slice(0, 120) || "Scheduled run";

  type Row = { body: string; at: Date };
  const wanted: Row[] = [];
  for (let i = 0; i < count; i++) {
    const body = str(formData.get(`body_${i}`));
    // A blank row is a spare, not a post. Leaving them out means somebody can
    // add ten boxes and fill in six without having to tidy up after themselves.
    if (!body) continue;

    const when = str(formData.get(`when_${i}`));       // "2026-08-14T09:30", IST
    // The browser gives a local wall-clock time with no zone. It is read as IST
    // because that is the only clock this business uses; parsing it as UTC would
    // publish everything five and a half hours early.
    const at = when ? new Date(`${when}:00+05:30`) : new Date(Date.now() + 2 * 3600e3);
    if (Number.isNaN(at.getTime())) continue;
    wanted.push({ body, at });
  }

  if (!wanted.length) redirect("/admin/campaigns/series?err=empty");

  // Oldest first, so the run reads in the order it will happen whatever order
  // the boxes were filled in.
  wanted.sort((a, b) => a.at.getTime() - b.at.getTime());

  const svc = createServiceClient();
  const campaignId = randomUUID();
  const flags = { ...ALL_CHANNEL_FLAGS } as Record<string, boolean>;
  for (const f of channels) flags[f] = true;

  // Which per-channel text column to fill. Instagram, YouTube and X each keep
  // their own copy of the wording; the rest read `body`.
  const voices = new Set(channels.map((f) => FIELD_TO_VOICE[f]));

  const rows = wanted.map((w, i) => ({
    ...flags,
    body: w.body,
    ig_text: voices.has("instagram") ? w.body : null,
    yt_text: voices.has("youtube_community") ? w.body : null,
    x_text: voices.has("twitter") ? w.body : null,
    campaign: name,
    campaign_id: campaignId,
    status: "draft",
    send_at: w.at.toISOString(),
    source_kind: "series",
    source_label: `${name} — ${i + 1} of ${wanted.length}`,
    created_by: "series",
  }));

  await svc.from("scheduled_posts").insert(rows);
  redirect(`/admin/campaigns/${campaignId}`);
}
