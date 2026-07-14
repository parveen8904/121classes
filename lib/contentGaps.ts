import { createServiceClient } from "@/lib/supabase/service";

// "What's missing" report for staff: for every subject and topic, list the
// content that hasn't been uploaded yet — transcripts, handwritten notes,
// revision videos/notes, books, RTP/MTP/past papers, MCQ/descriptive tests,
// most-important-questions lists. Shown on the control sheet and sent as a
// daily digest so forgotten items get flagged instead of discovered by
// students.

export type SubjectGaps = {
  subject: string;
  subjectGaps: string[];           // subject-level misses (MIQ lists, RTP/MTP…)
  topicGaps: { topic: string; missing: string[] }[]; // per-topic misses
};

const has = (v: unknown) => !!(v && String(v).trim());

export async function buildContentGapReport(): Promise<{ subjects: SubjectGaps[]; totalGaps: number }> {
  const svc = createServiceClient();
  const [{ data: subjects }, { data: topics }] = await Promise.all([
    svc.from("subjects").select("id, title, miq_rev1, miq_rev2").order("order_index").order("title"),
    svc
      .from("topics")
      .select("id, title, subject_id, order_index, is_combined, is_published, weightage_marks, important_qs_rev1, important_qs_rev2, book_pdf_url, revision_video_url, revision_notes_hand_url, revision_notes_typed_url")
      .eq("is_published", true)
      .order("order_index"),
  ]);
  const topicIds = (topics ?? []).map((t) => t.id as string);
  const subjectIds = (subjects ?? []).map((s) => s.id as string);

  const [{ data: secRows }, { data: repoRows }, { data: subjMats }, { data: mcqQ }, { data: subjQ }] = await Promise.all([
    topicIds.length
      ? svc.from("sections_meta").select("id, topic_id, type, class_no, notes_hand_url, has_transcript, paper_question_pdf, paper_solution_pdf").in("topic_id", topicIds).eq("is_published", true)
      : { data: [] as never[] },
    topicIds.length
      ? svc.from("repository_items").select("topic_id, kind").in("topic_id", topicIds).eq("is_active", true)
      : { data: [] as never[] },
    subjectIds.length
      ? svc.from("repository_items").select("subject_id, kind").in("subject_id", subjectIds).is("topic_id", null).eq("is_active", true)
      : { data: [] as never[] },
    svc.from("mcq_questions").select("section_id"),
    svc.from("subjective_questions").select("section_id"),
  ]);

  type Sec = { id: string; topic_id: string; type: string; class_no: string | null; notes_hand_url: string | null; has_transcript: boolean; paper_question_pdf: string | null; paper_solution_pdf: string | null };
  const secByTopic = new Map<string, Sec[]>();
  for (const r of (secRows ?? []) as Sec[]) {
    const arr = secByTopic.get(r.topic_id) ?? [];
    arr.push(r); secByTopic.set(r.topic_id, arr);
  }
  const repoByTopic = new Map<string, Set<string>>();
  for (const r of (repoRows ?? []) as { topic_id: string; kind: string }[]) {
    const set = repoByTopic.get(r.topic_id) ?? new Set<string>();
    set.add(r.kind); repoByTopic.set(r.topic_id, set);
  }
  const matsBySubject = new Map<string, Set<string>>();
  for (const r of (subjMats ?? []) as { subject_id: string; kind: string }[]) {
    const set = matsBySubject.get(r.subject_id) ?? new Set<string>();
    set.add(r.kind); matsBySubject.set(r.subject_id, set);
  }
  const mcqCounts = new Map<string, number>();
  for (const r of (mcqQ ?? []) as { section_id: string }[]) mcqCounts.set(r.section_id, (mcqCounts.get(r.section_id) ?? 0) + 1);
  const subjCounts = new Map<string, number>();
  for (const r of (subjQ ?? []) as { section_id: string }[]) subjCounts.set(r.section_id, (subjCounts.get(r.section_id) ?? 0) + 1);

  const out: SubjectGaps[] = [];
  let totalGaps = 0;

  for (const s of subjects ?? []) {
    const sg: string[] = [];
    if (!has(s.miq_rev1)) sg.push("most-important-questions list (1st revision)");
    if (!has(s.miq_rev2)) sg.push("most-important-questions list (2nd revision)");
    const mats = matsBySubject.get(s.id as string) ?? new Set<string>();
    if (!mats.has("rtp")) sg.push("RTP (subject level)");
    if (!mats.has("mtp")) sg.push("MTP (subject level)");
    if (!mats.has("past_papers")) sg.push("past exam papers (subject level)");

    const topicGaps: { topic: string; missing: string[] }[] = [];
    for (const t of (topics ?? []).filter((t) => t.subject_id === s.id && !t.is_combined)) {
      const secs = secByTopic.get(t.id as string) ?? [];
      const classSecs = secs.filter((x) => x.type === "full_class_video");
      const classes = classSecs.filter((x) => !/[A-Za-z]/.test(String(x.class_no ?? ""))).length;
      const missing: string[] = [];
      if (!classSecs.length) missing.push("classes");
      else {
        const noNotes = classSecs.filter((x) => !has(x.notes_hand_url)).length;
        const noTranscript = classSecs.filter((x) => !x.has_transcript).length;
        if (noNotes) missing.push(`handwritten notes for ${noNotes} of ${classes} classes`);
        if (noTranscript) missing.push(`transcripts for ${noTranscript} classes`);
      }
      const repo = repoByTopic.get(t.id as string) ?? new Set<string>();
      if (!secs.some((x) => x.type === "revision_video") && !has(t.revision_video_url)) missing.push("revision video");
      if (!has(t.revision_notes_hand_url) && !has(t.revision_notes_typed_url)) missing.push("revision notes");
      if (!has(t.book_pdf_url) && !repo.has("book")) missing.push("book PDF");
      if (!has(t.important_qs_rev1)) missing.push("important questions (rev 1)");
      const mcqSecs = secs.filter((x) => x.type === "mcq_test");
      if (!mcqSecs.length) missing.push("MCQ test");
      else if (mcqSecs.some((x) => !(mcqCounts.get(x.id) ?? 0))) missing.push("MCQ test has no questions");
      const descSecs = secs.filter((x) => x.type === "subjective_test");
      if (!descSecs.length) missing.push("descriptive test");
      else {
        if (descSecs.some((x) => !has(x.paper_question_pdf) && !(subjCounts.get(x.id) ?? 0))) missing.push("descriptive question paper");
        if (descSecs.some((x) => has(x.paper_question_pdf) && !has(x.paper_solution_pdf))) missing.push("descriptive solution PDF (for AI grading)");
      }
      if (missing.length) topicGaps.push({ topic: t.title as string, missing });
      totalGaps += missing.length;
    }
    totalGaps += sg.length;
    out.push({ subject: s.title as string, subjectGaps: sg, topicGaps });
  }
  return { subjects: out, totalGaps };
}

// Plain-text version for the daily staff digest (email + Telegram).
export function gapReportToText(r: { subjects: SubjectGaps[]; totalGaps: number }): string {
  const lines: string[] = [`📋 Content check — ${r.totalGaps} missing item${r.totalGaps === 1 ? "" : "s"}`];
  for (const s of r.subjects) {
    if (!s.subjectGaps.length && !s.topicGaps.length) { lines.push(`\n✅ ${s.subject}: complete`); continue; }
    lines.push(`\n📂 ${s.subject}`);
    for (const g of s.subjectGaps) lines.push(`  • Subject: missing ${g}`);
    for (const t of s.topicGaps.slice(0, 25)) lines.push(`  • ${t.topic}: ${t.missing.join(", ")}`);
    if (s.topicGaps.length > 25) lines.push(`  …and ${s.topicGaps.length - 25} more topics with gaps`);
  }
  lines.push(`\nFull details: https://caparveensharma.com/admin/control-sheet`);
  return lines.join("\n");
}
