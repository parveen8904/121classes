import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured, extractConcepts } from "@/lib/ai";

type Topic = { id: string; title: string; subject?: { title?: string; course_id?: string } | null };

// Looks at a student's recent questions, works out their weak concepts, and
// matches them to topics (videos + tests + material live on the topic page) and
// repository material. Best-effort; returns null if AI is off or nothing matches.
type Reco = {
  concepts: string[];
  topics: Topic[];
  material: { id: string; title: string }[];
  classes: { topicId: string; topicTitle: string; classTitle: string }[];
};

export async function getStudyRecommendations(userId: string): Promise<Reco | null> {
  if (!(await aiConfigured())) return null;
  const svc = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Daily cache — avoid re-running AI on every inbox open.
  const { data: cached } = await svc.from("ai_reco_cache").select("day, data").eq("user_id", userId).maybeSingle();
  if (cached && cached.day === today) return (cached.data as Reco | null) ?? null;
  const save = async (result: Reco | null): Promise<Reco | null> => {
    await svc.from("ai_reco_cache").upsert({ user_id: userId, day: today, data: result, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    return result;
  };

  const [{ data: pq }, { data: doubts }] = await Promise.all([
    svc.from("page_questions").select("question, page_path").eq("user_id", userId).order("created_at", { ascending: false }).limit(15),
    svc.from("doubts").select("question").eq("student_id", userId).order("created_at", { ascending: false }).limit(15),
  ]);
  const qs = [
    ...(pq ?? []).filter((r) => !(r.page_path ?? "").startsWith("reply:")).map((r) => r.question),
    ...(doubts ?? []).map((d) => d.question),
  ].filter(Boolean);
  if (qs.length === 0) return null; // no questions yet → nothing to cache (no AI used)

  const concepts = await extractConcepts(qs.join("\n"));
  if (concepts.length === 0) return save(null);

  const topics = new Map<string, Topic>();
  const material = new Map<string, { id: string; title: string }>();
  const classes = new Map<string, { topicId: string; topicTitle: string; classTitle: string }>();
  for (const c of concepts) {
    const term = c.replace(/[%_]/g, "").slice(0, 40);
    if (term.length < 2) continue;
    const [{ data: t }, { data: m }, { data: cls }] = await Promise.all([
      svc.from("topics").select("id, title, subject_id, subjects(title, course_id)").ilike("title", `%${term}%`).eq("is_published", true).limit(4),
      svc.from("repository_items").select("id, title").ilike("title", `%${term}%`).eq("is_active", true).limit(4),
      // the specific class (video) that teaches this concept — so a weak student
      // can jump straight to it.
      svc
        .from("sections")
        .select("id, title, topic_id, topics(title)")
        .eq("type", "full_class_video")
        .eq("is_published", true)
        .or(`config->>ai_key_points.ilike.%${term}%,config->>important_concepts.ilike.%${term}%`)
        .limit(3),
    ]);
    for (const row of t ?? []) topics.set(row.id, { id: row.id, title: row.title, subject: (row as any).subjects });
    for (const row of m ?? []) material.set(row.id, { id: row.id, title: row.title });
    for (const row of cls ?? [])
      classes.set(row.id, { topicId: row.topic_id, topicTitle: (row as any).topics?.title ?? "", classTitle: row.title });
  }

  return save({
    concepts,
    topics: [...topics.values()].slice(0, 6),
    material: [...material.values()].slice(0, 6),
    classes: [...classes.values()].slice(0, 6),
  });
}
