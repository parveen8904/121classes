import { createServiceClient } from "@/lib/supabase/service";

// Build the study-material context the AI is grounded on. Pulls from TWO
// sources, both validity/subject-aware and capped to a context budget:
//   1. repository_items — bulk uploads (transcripts, ICAI text, notes).
//   2. The structured course content — per topic: weightage, important
//      questions/concepts, and per class: transcript, concepts, homework.
// This is the unified repository: anything entered for students is available
// to the AI without re-uploading.
export async function getRepositoryContext(
  subjectId?: string | null,
  maxChars = 40000,
  opts: { topicId?: string | null; query?: string } = {},
): Promise<string> {
  const svc = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // --- Source 1: repository_items ---
  const { data: items } = await svc
    .from("repository_items")
    .select("title, content, subject_id, valid_from, valid_to")
    .eq("is_active", true)
    .not("content", "is", null)
    .order("created_at", { ascending: false });

  const itemRows = (items ?? []).filter((r) => {
    if (!r.content) return false;
    if (r.valid_from && r.valid_from > today) return false;
    if (r.valid_to && r.valid_to < today) return false;
    return true;
  });

  // --- Source 2: structured topics + their classes ---
  const { data: topics } = await svc
    .from("topics")
    .select("id, title, subject_id, weightage_marks, important_qs_rev1, important_qs_rev2, valid_from_attempt, valid_to_attempt, subjects(title)")
    .eq("is_published", true);
  const topicIds = (topics ?? []).map((t) => t.id);
  const { data: sections } = topicIds.length
    ? await svc.from("sections").select("topic_id, title, config").in("topic_id", topicIds).eq("is_published", true)
    : { data: [] as { topic_id: string; title: string; config: Record<string, unknown> | null }[] };
  const secByTopic = new Map<string, { title: string; config: Record<string, unknown> }[]>();
  for (const s of sections ?? []) {
    if (!secByTopic.has(s.topic_id)) secByTopic.set(s.topic_id, []);
    secByTopic.get(s.topic_id)!.push({ title: s.title, config: (s.config ?? {}) as Record<string, unknown> });
  }

  type Chunk = { subject_id: string | null; topic_id: string | null; text: string };
  const chunks: Chunk[] = [];

  for (const r of itemRows) chunks.push({ subject_id: r.subject_id, topic_id: null, text: `### ${r.title}\n${r.content}` });

  for (const t of topics ?? []) {
    const subj = (t as { subjects?: { title?: string } | null }).subjects?.title ?? "";
    const lines: string[] = [];
    const head = `### ${subj ? subj + " — " : ""}${t.title}`;
    const meta: string[] = [];
    if (t.weightage_marks) meta.push(`weightage ${t.weightage_marks} marks (ICAI)`);
    if (t.valid_from_attempt) meta.push(`applicable ${t.valid_from_attempt}${t.valid_to_attempt ? `–${t.valid_to_attempt}` : ""}`);
    if (meta.length) lines.push(`(${meta.join("; ")})`);
    if (t.important_qs_rev1) lines.push(`First-revision important questions:\n${t.important_qs_rev1}`);
    if (t.important_qs_rev2) lines.push(`Second-revision important questions:\n${t.important_qs_rev2}`);
    for (const s of secByTopic.get(t.id) ?? []) {
      const c = s.config;
      const parts: string[] = [];
      if (c.important_concepts) parts.push(`Important concepts: ${c.important_concepts}`);
      if (c.important_questions) parts.push(`Important questions: ${c.important_questions}`);
      if (c.homework) parts.push(`Homework: ${c.homework}`);
      if (c.transcript) parts.push(`Transcript:\n${c.transcript}`);
      if (parts.length) lines.push(`— ${s.title} —\n${parts.join("\n")}`);
    }
    if (lines.length) chunks.push({ subject_id: t.subject_id, topic_id: t.id, text: `${head}\n${lines.join("\n")}` });
  }

  // 1) If a specific topic is in focus (e.g. a doubt asked inside a class),
  //    use ONLY that topic's material — far smaller input.
  let pool = chunks;
  if (opts.topicId) {
    const topicOnly = chunks.filter((c) => c.topic_id === opts.topicId);
    if (topicOnly.length) pool = topicOnly;
  }

  // 2) If we have the question text, keep only chunks that mention its key words
  //    (relevance filter, most-relevant first) — cuts input several-fold for
  //    general doubts.
  let ranked = false;
  if (pool === chunks && opts.query) {
    const terms = [...new Set((opts.query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []))];
    if (terms.length) {
      const scored = pool
        .map((c) => ({ c, s: terms.reduce((n, w) => n + (c.text.toLowerCase().includes(w) ? 1 : 0), 0) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      if (scored.length) {
        pool = scored.map((x) => x.c);
        ranked = true;
      }
    }
  }

  // Subject-specific first, then general (no subject), then the rest — unless we
  // already ordered by relevance to the question.
  if (!ranked) {
    pool.sort((a, b) => {
      const rank = (s: string | null) => (s === subjectId ? 0 : s ? 2 : 1);
      return rank(a.subject_id) - rank(b.subject_id);
    });
  }

  let out = "";
  for (const ch of pool) {
    const chunk = `\n\n${ch.text}`;
    if (out.length + chunk.length > maxChars) {
      out += chunk.slice(0, Math.max(0, maxChars - out.length));
      break;
    }
    out += chunk;
  }
  return out.trim();
}
