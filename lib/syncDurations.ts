import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { resequenceSubjectClasses } from "@/app/admin/topics/[topicId]/actions";

// Pull real class durations from Bunny (the video's encoded length) into
// sections.config.duration_minutes, then refresh class numbering for the
// affected subjects — short (≤100 min) classes become part-continuations
// (7B, 7C…) instead of inflating the class count. Runs from the hourly cron;
// skips classes that already have a duration, so steady-state is a no-op.
export async function syncClassDurations(limit = 120): Promise<{ updated: number; remaining: number }> {
  const svc = createServiceClient();
  const key = await getSecret("BUNNY_STREAM_API_KEY");
  const lib = await getSecret("BUNNY_LIBRARY_ID");
  if (!key || !lib) return { updated: 0, remaining: 0 };

  const { data: secs } = await svc
    .from("sections")
    .select("id, config, topics(subject_id)")
    .in("type", ["full_class_video", "revision_video"]);

  const missing = (secs ?? []).filter((s) => {
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    return cfg.bunny_video_id && !(Number(cfg.duration_minutes) > 0);
  });

  let updated = 0;
  const subjects = new Set<string>();
  for (const s of missing.slice(0, limit)) {
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    const res = await fetch(`https://video.bunnycdn.com/library/${lib}/videos/${cfg.bunny_video_id}`, {
      headers: { AccessKey: key, accept: "application/json" },
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) continue;
    const v = (await res.json().catch(() => null)) as { length?: number } | null;
    const mins = Math.round((Number(v?.length) || 0) / 60);
    if (!mins) continue; // still encoding — the next hourly run picks it up
    await svc.from("sections").update({ config: { ...cfg, duration_minutes: mins } }).eq("id", s.id);
    const subjectId = (s as { topics?: { subject_id?: string } | null }).topics?.subject_id;
    if (subjectId) subjects.add(subjectId);
    updated++;
  }
  for (const sid of subjects) await resequenceSubjectClasses(sid);
  return { updated, remaining: missing.length - updated };
}
