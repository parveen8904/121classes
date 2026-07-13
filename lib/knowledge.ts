import { createServiceClient } from "@/lib/supabase/service";
import { summarizeClass } from "@/lib/ai";

// Pre-build the AI knowledge base ONCE per class, so doubts answer from small,
// clean, saved digests instead of re-sending the big raw transcript every time.
// This is the cost + quality win: a transcript is ~10–20k characters of messy
// spoken Hinglish; its digest is a few hundred clean characters. Doubts then
// cost a fraction and read better. Runs a few classes per cron tick (cheap
// Haiku), skips anything already digested, so steady-state is a no-op.
export async function digestPendingClasses(limit = 4): Promise<{ digested: number; remaining: number }> {
  const svc = createServiceClient();

  // Classes that HAVE a transcript but NO digest yet.
  const { data: rows } = await svc
    .from("sections")
    .select("id, config")
    .eq("type", "full_class_video")
    .eq("is_published", true);

  const pending = (rows ?? []).filter((s) => {
    const c = (s.config ?? {}) as Record<string, unknown>;
    return String(c.transcript ?? "").length > 200 && !String(c.ai_summary ?? "").trim();
  });

  let digested = 0;
  for (const s of pending.slice(0, limit)) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    const result = await summarizeClass(String(c.transcript));
    if (!result) continue; // AI hiccup — retry next tick
    await svc.from("sections").update({
      config: {
        ...c,
        ai_summary: result.summary,
        ai_questions_discussed: result.questions_discussed.join("\n"),
        ai_concepts_discussed: result.concepts_discussed.join("\n"),
        ai_homework_count: result.homework_covered_count,
        ai_homework_next: result.homework_next,
      },
    }).eq("id", s.id);
    digested++;
  }
  return { digested, remaining: pending.length - digested };
}
