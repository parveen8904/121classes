import { createServiceClient } from "@/lib/supabase/service";

// Build the study-material context the AI is grounded on. Pulls from TWO
// sources, both validity/subject-aware and capped to a context budget:
//   1. repository_items — bulk uploads (transcripts, ICAI text, notes).
//   2. The structured course content — per topic: weightage, important
//      questions/concepts, and per class: transcript, concepts, homework.
// This is the unified repository: anything entered for students is available
// to the AI without re-uploading.
// Words that describe the ASKING rather than the subject. They appear in
// almost every class, so counting them buries the one word that matters.
const ASKING_WORDS = new Set([
  "which", "what", "where", "when", "explain", "explained", "explains", "explaining",
  "class", "classes", "lecture", "lectures", "video", "videos", "chapter", "topic",
  "sharma", "parveen", "sir", "maam", "madam", "please", "kindly", "tell", "told",
  "about", "regarding", "there", "these", "those", "have", "having", "does", "doing",
  "study", "material", "learn", "watch", "number", "numbers", "kaun", "kaunsi",
  "konsi", "kaha", "kahan", "bata", "batao", "samjha", "samjhaya", "padhaya",
]);

/**
 * Cut a long document into overlapping passages so each can be ranked on its own.
 *
 * PASSAGE and OVERLAP are chosen against the 12,000-character budget a group
 * doubt gets: four or five passages of real teaching fit, which is enough to
 * answer from and small enough that the ranking above decides WHICH four.
 * The overlap exists so a rule broken across a boundary is still found whole in
 * one of the two halves.
 */
const PASSAGE = 2500;
const OVERLAP = 400;

function passages(content: string): string[] {
  const text = (content ?? "").trim();
  if (text.length <= PASSAGE) return text ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += PASSAGE - OVERLAP) {
    out.push(text.slice(i, i + PASSAGE));
    // A guard, not a limit anyone should hit: 4,000 passages is ten million
    // characters from a single item.
    if (out.length >= 4000) break;
  }
  return out;
}

export async function getRepositoryContext(
  subjectId?: string | null,
  maxChars = 40000,
  opts: { topicId?: string | null; query?: string } = {},
): Promise<string> {
  const svc = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // --- Source 1: his written material, THROUGH THE INDEX ---
  //
  // This used to fetch every active repository item's full CONTENT — his books
  // among them, one of which is 1.6 million characters — on every single student
  // doubt, then score whole documents by counting words and slice the winner at
  // the character budget. Two things were wrong with that. It shipped megabytes
  // out of the database to answer one question. And because a book scored as ONE
  // thing, what got handed to the model was the book's FIRST 12,000 characters:
  // its opening pages, whatever the question.
  //
  // That is why a room of Final students was told the IFRS answer on FCCBs while
  // the Ind AS carve-out sat at character 46,201 of a file we owned.
  //
  // Now the material is cut into passages once, indexed with Postgres full-text
  // search, and a question is a LOOKUP: level first (an Inter student is never
  // answered out of a Final book), then the topic if we know it, then the
  // passages that actually discuss what was asked.
  const itemChunksFromIndex: { subject_id: string | null; topic_id: string | null; text: string }[] = [];
  let usedIndex = false;
  if (opts.query && opts.query.trim().length > 2) {
    // Enough passages to fill the budget with a little to spare, since the
    // ranking decides which survive the character cut below.
    const want = Math.min(40, Math.max(6, Math.ceil(maxChars / 2000) + 3));
    const { data: hits, error } = await svc.rpc("search_repository", {
      p_query: opts.query,
      p_subject: subjectId ?? null,
      p_limit: want,
      p_topic: opts.topicId ?? null,
    });
    if (!error && hits) {
      for (const h of hits as { title: string; body: string; topic_id: string | null }[]) {
        itemChunksFromIndex.push({
          subject_id: subjectId ?? null,
          topic_id: h.topic_id ?? null,
          text: `### ${h.title}\n${h.body}`,
        });
      }
      usedIndex = true;
    }
  }

  // Fallback for the rare call with no question to search on (a general context
  // build). Titles only — never the full content of every book again.
  let itemRows: { title: string; content: string; subject_id: string | null; topic_id?: string | null }[] = [];
  if (!usedIndex) {
    let itemsQ = svc
      .from("repository_items")
      .select("title, content, subject_id, topic_id, valid_from, valid_to")
      .eq("is_active", true)
      .not("content", "is", null)
      .order("created_at", { ascending: false })
      .limit(40);
    if (subjectId) itemsQ = itemsQ.or(`subject_id.eq.${subjectId},subject_id.is.null`);
    const { data: items } = await itemsQ;
    itemRows = ((items ?? []) as typeof itemRows & { valid_from?: string; valid_to?: string }[]).filter((r) => {
      if (!r.content || r.content === "__unreadable__") return false;
      const vf = (r as { valid_from?: string }).valid_from;
      const vt = (r as { valid_to?: string }).valid_to;
      if (vf && vf > today) return false;
      if (vt && vt < today) return false;
      return true;
    });
  }

  // --- Source 2: structured topics + their classes ---
  // Topics are scoped to the subject (or focus topic) in the DB; the per-class
  // configs (transcripts, digests — the HEAVY part) are only fetched for that
  // scope, never site-wide.
  type SectionRow = { id: string; topic_id: string; title: string } & Record<string, string | null>;
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
    ? await svc
        .from("sections")
        // Project ONLY the eleven keys used below. Each config row is around
        // 39 kB and the rest of it (video ids, ui state, import summaries) is
        // shipped for nothing — on a query that runs for every AI answer.
        // Everything the loop below reads EXCEPT the transcript. A transcript
        // is only used when the class has no digest, but fetching it for every
        // row shipped 30 MB of the 36 MB straight into the bin.
        .select(
          "id, topic_id, title, ai_summary:config->>ai_summary, ai_concepts_discussed:config->>ai_concepts_discussed, " +
            "ai_questions_discussed:config->>ai_questions_discussed, ai_key_points:config->>ai_key_points, " +
            "important_concepts:config->>important_concepts, important_questions:config->>important_questions, " +
            "homework:config->>homework, notes_text:config->>notes_text, ai_pdf_text:config->>ai_pdf_text, " +
            "class_no:config->>class_no",
        )
        .in("topic_id", topicIds)
        .eq("is_published", true)
    : { data: [] as SectionRow[] };
  // Now fetch transcripts for ONLY the classes that have no digest — those are
  // the sole rows where the loop below will actually use one.
  const needTranscript = ((sections ?? []) as SectionRow[])
    .filter((s) => !String(s.ai_summary ?? "").trim())
    .map((s) => s.id);
  const { data: transcripts } = needTranscript.length
    ? await svc.from("sections").select("id, transcript:config->>transcript").in("id", needTranscript)
    : { data: [] as { id: string; transcript: string | null }[] };
  const transcriptById = new Map(
    ((transcripts ?? []) as { id: string; transcript: string | null }[]).map((t) => [t.id, t.transcript]),
  );

  const secByTopic = new Map<string, { title: string; config: Record<string, unknown> }[]>();
  for (const s of (sections ?? []) as SectionRow[]) {
    if (!secByTopic.has(s.topic_id)) secByTopic.set(s.topic_id, []);
    const { id, topic_id: _t, title, ...cfg } = s;
    secByTopic.get(s.topic_id)!.push({
      title,
      config: { ...cfg, transcript: transcriptById.get(id) ?? null } as Record<string, unknown>,
    });
  }

  type Chunk = { subject_id: string | null; topic_id: string | null; text: string };
  const chunks: Chunk[] = [];

  // The written material, already narrowed by the index above.
  if (usedIndex) {
    chunks.push(...itemChunksFromIndex);
  } else {
    for (const r of itemRows) {
      for (const piece of passages(String(r.content))) {
        chunks.push({ subject_id: r.subject_id, topic_id: r.topic_id ?? null, text: `### ${r.title}\n${piece}` });
      }
    }
  }

  // --- Source 3: published amendments (their body IS teaching text) ---
  const { data: amends } = await svc
    .from("amendments").select("title, body, subject_id, topic_id").eq("is_published", true).not("body", "is", null);
  for (const a of amends ?? []) {
    if (!String(a.body ?? "").trim()) continue;
    chunks.push({ subject_id: (a as { subject_id?: string | null }).subject_id ?? null, topic_id: (a as { topic_id?: string | null }).topic_id ?? null, text: `### Amendment — ${a.title}\n${a.body}` });
  }

  const classChunks: Chunk[] = [];
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
      // EACH CLASS IS ITS OWN CHUNK.
      //
      // A whole topic used to travel as one block, so "which class explained
      // investments?" competed at topic granularity and the answer — a class
      // number sitting somewhere inside a very long block — was as likely to be
      // cut off by the character budget as to be read. A class is the unit the
      // student is asking about, so it is the unit that gets ranked and kept.
      if (parts.length) {
        classChunks.push({
          subject_id: t.subject_id,
          topic_id: t.id,
          text: `### ${subj ? subj + " — " : ""}${t.title}\n— ${cno}${s.title} —\n${parts.join("\n")}`,
        });
      }
    }
    // The topic's own material (weightage, important-question lists) still
    // travels as one piece; it belongs to the topic, not to any one class.
    if (lines.length) chunks.push({ subject_id: t.subject_id, topic_id: t.id, text: `${head}\n${lines.join("\n")}` });
  }

  // 1) If a specific topic is in focus (e.g. a doubt asked inside a class),
  //    use ONLY that topic's material — far smaller input.
  chunks.push(...classChunks);

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
    // WORDS THAT ACTUALLY NARROW ANYTHING.
    //
    // "In which class did Sharma Sir explain investments?" scored six words —
    // and five of them (which, class, sharma, explained, about) appear in
    // essentially every chunk here. The one word that mattered, "investment",
    // counted for a sixth of the score, so the ranking was decided by question
    // shape rather than subject, and the right class never rose to the top.
    //
    // A term found nearly everywhere tells us nothing, so it is worth nothing.
    const terms = [...new Set((opts.query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []))]
      .filter((w) => !ASKING_WORDS.has(w));
    if (terms.length) {
      const lower = pool.map((c) => c.text.toLowerCase());
      // How many chunks contain each term. Anything in more than half of them
      // is doing no work.
      const spread = new Map(terms.map((w) => [w, lower.filter((t) => t.includes(w)).length]));
      const useful = terms.filter((w) => (spread.get(w) ?? 0) <= pool.length * 0.5);
      const scoring = useful.length ? useful : terms;

      const scored = pool
        .map((c, i) => ({
          c,
          // Rarer terms weigh more, so one mention of "investment" beats five
          // mentions of "class".
          s: scoring.reduce((n, w) => {
            if (!lower[i].includes(w)) return n;
            const seen = spread.get(w) ?? 1;
            return n + Math.max(1, Math.round(pool.length / Math.max(1, seen)));
          }, 0),
        }))
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
