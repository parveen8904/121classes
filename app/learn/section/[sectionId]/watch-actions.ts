"use server";

import { createClient } from "@/lib/supabase/server";

// Record a chunk of watching: how far in the video (videoSeconds) and how much
// real wall-clock time was spent (deltaRealSeconds) since the last record. The
// gap between the two over a session reveals pace / breaks / re-watching.
export async function recordWatch(input: {
  sectionId: string;
  videoSeconds: number;
  deltaRealSeconds: number;
  durationSeconds: number;
  ended: boolean;
}): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  if (!input.sectionId) return;

  const vs = Math.max(0, Math.round(input.videoSeconds || 0));
  const delta = Math.min(3600, Math.max(0, Math.round(input.deltaRealSeconds || 0)));
  const dur = Math.max(0, Math.round(input.durationSeconds || 0));

  const { data: existing } = await supabase
    .from("class_watch")
    .select("video_seconds, real_seconds, duration_seconds, completed")
    .eq("student_id", user.id)
    .eq("section_id", input.sectionId)
    .maybeSingle();

  const newVideo = Math.max(Number(existing?.video_seconds ?? 0), vs);
  const newReal = Number(existing?.real_seconds ?? 0) + delta;
  const duration = dur || Number(existing?.duration_seconds ?? 0);
  const wasCompleted = existing?.completed ?? false;
  const completed = input.ended || wasCompleted || (duration > 0 && newVideo >= duration * 0.9);

  await supabase.from("class_watch").upsert(
    {
      student_id: user.id,
      section_id: input.sectionId,
      video_seconds: newVideo,
      real_seconds: newReal,
      duration_seconds: duration,
      completed,
      last_watched_at: new Date().toISOString(),
    },
    { onConflict: "student_id,section_id" },
  );

  if (completed && !wasCompleted) {
    await supabase.from("student_activity").insert({
      student_id: user.id,
      kind: "class_complete",
      section_id: input.sectionId,
      detail: { video_seconds: newVideo, real_seconds: newReal },
    });
  }
}

// Generic activity log entry (class opened, test given, doubt asked, etc.).
export async function logActivity(kind: string, opts?: { sectionId?: string; topicId?: string; detail?: Record<string, unknown> }): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !kind) return;
  await supabase.from("student_activity").insert({
    student_id: user.id,
    kind,
    section_id: opts?.sectionId ?? null,
    topic_id: opts?.topicId ?? null,
    detail: opts?.detail ?? null,
  });
}
