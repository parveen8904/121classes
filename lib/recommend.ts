import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured, extractConcepts } from "@/lib/ai";

type Topic = { id: string; title: string; subject?: { title?: string; course_id?: string } | null };

// Looks at a student's recent questions, works out their weak concepts, and
// matches them to topics (videos + tests + material live on the topic page) and
// repository material. Best-effort; returns null if AI is off or nothing matches.
export async function getStudyRecommendations(
  userId: string,
): Promise<{ concepts: string[]; topics: Topic[]; material: { id: string; title: string }[] } | null> {
  if (!(await aiConfigured())) return null;
  const svc = createServiceClient();

  const [{ data: pq }, { data: doubts }] = await Promise.all([
    svc.from("page_questions").select("question, page_path").eq("user_id", userId).order("created_at", { ascending: false }).limit(15),
    svc.from("doubts").select("question").eq("student_id", userId).order("created_at", { ascending: false }).limit(15),
  ]);
  const qs = [
    ...(pq ?? []).filter((r) => !(r.page_path ?? "").startsWith("reply:")).map((r) => r.question),
    ...(doubts ?? []).map((d) => d.question),
  ].filter(Boolean);
  if (qs.length === 0) return null;

  const concepts = await extractConcepts(qs.join("\n"));
  if (concepts.length === 0) return null;

  const topics = new Map<string, Topic>();
  const material = new Map<string, { id: string; title: string }>();
  for (const c of concepts) {
    const term = c.replace(/[%_]/g, "").slice(0, 40);
    if (term.length < 2) continue;
    const [{ data: t }, { data: m }] = await Promise.all([
      svc.from("topics").select("id, title, subject_id, subjects(title, course_id)").ilike("title", `%${term}%`).eq("is_published", true).limit(4),
      svc.from("repository_items").select("id, title").ilike("title", `%${term}%`).eq("is_active", true).limit(4),
    ]);
    for (const row of t ?? []) topics.set(row.id, { id: row.id, title: row.title, subject: (row as any).subjects });
    for (const row of m ?? []) material.set(row.id, { id: row.id, title: row.title });
  }

  return { concepts, topics: [...topics.values()].slice(0, 6), material: [...material.values()].slice(0, 6) };
}
