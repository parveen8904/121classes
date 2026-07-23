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
  // Scoped at the QUERY level: this runs on every AI doubt, and fetching the
  // whole site's content to keep 40k chars was starving the database.
  let itemsQ = svc
    .from("repository_items")
    .select("title, content, subject_id, topic_id, valid_from, valid_to")
    .eq("is_active", true)
    .not("content", "is", null)
    .order("created_at", { ascending: false });
  if (subjectId) itemsQ = itemsQ.or(`subject_id.eq.${subjectId},subject_id.is.null`);
  const { data: items } = await itemsQ;

  const itemRows = (items ?? []).filter((r) => {
    if (!r.content) return false;
    if (r.valid_from && r.valid_from > today) return false;
    if (r.valid_to && r.valid_to < today) return false;
    return true;
  });

  // --- Source 2: structured topics + their classes ---
  // Topics are scoped to the subject (or focus topic) in the DB; the per-class
  // configs (transcripts, digests — the HEAVY part) are only fetched for that
  // scope, never site-wide.
  let topicsQ = svc
    .from("topics")
    .select("id, title, subject_id, weightage_marks, important_qs_rev1, important_qs_rev2, valid_from_attempt, valid_to_attempt, subjects(title)")
    .eq("is_published", true);
  if (subjectId) topicsQ = topicsQ.eq("subject_id", subjectId);
  else if (opts.topicId) topicsQ = topicsQ.eq("id", opts.topicId);
  const { data: topics } = await topicsQ;
  const scoped = !!(subjectId || opts.topicId);
  const topicIds = scoped ? (topics ?? []).map((t) => t.id) : [];
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

  for (const r of itemRows) chunks.push({ subject_id: r.subject_id, topic_id: (r as { topic_id?: string | null }).topic_id ?? null, text: `### ${r.title}\n${r.content}` });

  // --- Source 3: published amendments (their body IS teaching text) ---
  const { data: amends } = await svc
    .from("amendments").select("title, body, subject_id, topic_id").eq("is_published", true).not("body", "is", null);
  for (const a of amends ?? []) {
    if (!String(a.body ?? "").trim()) continue;
    chunks.push({ subject_id: (a as { subject_id?: string | null }).subject_id ?? null, topic_id: (a as { topic_id?: string | null }).topic_id ?? null, text: `### Amendment — ${a.title}\n${a.body}` });
  }

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
      // A digest exists → use the CLEAN, small digest and SKIP the huge raw
      // transcript (big token + cost saving; the digest is what the AI reads).
      const hasDigest = !!c.ai_summary;
      if (c.ai_summary) parts.push(`Class summary: ${c.ai_summary}`);
      if (c.ai_concepts_discussed) parts.push(`Concepts covered: ${String(c.ai_concepts_discussed).split("\n").filter(Boolean).join("; ")}`);
      if (c.ai_questions_discussed) parts.push(`Questions discussed: ${String(c.ai_questions_discussed).split("\n").filter(Boolean).join("; ")}`);
      if (c.ai_key_points) parts.push(`Key concepts: ${String(c.ai_key_points).split("\n").filter(Boolean).join("; ")}`);
      if (c.important_concepts) parts.push(`Important concepts: ${c.important_concepts}`);
      if (c.important_questions) parts.push(`Important questions: ${c.important_questions}`);
      if (c.homework) parts.push(`Homework: ${c.homework}`);
      if (c.notes_text) parts.push(`Handwritten class notes:\n${c.notes_text}`); // OCR'd faculty notes
      if (c.ai_pdf_text) parts.push(`PDF content:\n${c.ai_pdf_text}`);
      if (!hasDigest && c.transcript) parts.push(`Transcript:\n${c.transcript}`); // fallback until digested
      // Label each class with its CLASS NUMBER so the AI can tell the student
      // which class to watch for this concept.
      const cno = c.class_no ? `Class ${c.class_no} — ` : "";
      if (parts.length) lines.push(`— ${cno}${s.title} —\n${parts.join("\n")}`);
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
