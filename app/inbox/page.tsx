import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getStudyRecommendations } from "@/lib/recommend";
import { getSubjModelAnswers } from "@/lib/answers";
import InboxView, { type Msg } from "./InboxView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox — 121 CA Classes" };

export default async function StudentInbox() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/inbox");

  const svc = createServiceClient();
  const [{ data: pq }, { data: doubts }, { data: subs }] = await Promise.all([
    svc.from("page_questions").select("id, question, page_path, status, created_at").eq("user_id", user.id).order("created_at", { ascending: true }),
    svc.from("doubts").select("id, question, ai_answer, status, created_at").eq("student_id", user.id).order("created_at", { ascending: true }),
    svc.from("subjective_submissions").select("id, question_id, answer_text, ai_score, ai_feedback, status, created_at").eq("student_id", user.id).order("created_at", { ascending: false }).limit(50),
  ]);

  // Thread page_questions: questions + their linked reply rows.
  const replies = new Map<string, { text: string; kind: string }[]>();
  for (const r of pq ?? []) {
    const pp = r.page_path ?? "";
    if (pp.startsWith("reply:")) {
      const parent = pp.slice(6);
      if (!replies.has(parent)) replies.set(parent, []);
      replies.get(parent)!.push({ text: r.question, kind: r.status === "reply" ? "reply" : "answer" });
    }
  }

  const messages: Msg[] = [];
  for (const r of pq ?? []) {
    if ((r.page_path ?? "").startsWith("reply:")) continue;
    const answers = replies.get(r.id) ?? [];
    messages.push({
      id: r.id,
      kind: "question",
      when: r.created_at,
      title: r.question,
      status: r.status,
      answers,
      shareText: `Q: ${r.question}` + (answers[0] ? `\n\nA: ${answers[0].text}` : ""),
    });
  }
  for (const d of doubts ?? []) {
    messages.push({
      id: "doubt:" + d.id,
      kind: "question",
      when: d.created_at,
      title: d.question,
      status: d.status,
      answers: d.ai_answer ? [{ text: d.ai_answer, kind: "answer" }] : [],
      shareText: `Q: ${d.question}` + (d.ai_answer ? `\n\nA: ${d.ai_answer}` : ""),
    });
  }

  // Papers (graded subjective submissions) + their saved model answers.
  const subQIds = [...new Set((subs ?? []).map((s) => s.question_id))];
  const { data: subQs } = subQIds.length
    ? await svc.from("subjective_questions").select("id, prompt, max_marks").in("id", subQIds)
    : { data: [] as { id: string; prompt: string; max_marks: number | null }[] };
  const qMap = new Map((subQs ?? []).map((q) => [q.id, q]));
  const modelAnswers = await getSubjModelAnswers(subQIds);

  for (const s of subs ?? []) {
    const q = qMap.get(s.question_id);
    const mm = q?.max_marks ?? 10;
    messages.push({
      id: "paper:" + s.id,
      kind: "paper",
      when: s.created_at,
      title: q?.prompt ?? "Descriptive paper",
      status: s.status,
      score: typeof s.ai_score === "number" ? s.ai_score : null,
      max: mm,
      yourAnswer: s.answer_text,
      feedback: s.ai_feedback,
      suggested: modelAnswers.get(s.question_id),
      shareText:
        `Question: ${q?.prompt ?? ""}\n\nMy answer: ${s.answer_text}` +
        (typeof s.ai_score === "number" ? `\n\nScore: ${s.ai_score}/${mm}` : "") +
        (s.ai_feedback ? `\n\nFeedback: ${s.ai_feedback}` : ""),
    });
  }

  messages.sort((a, b) => (a.when < b.when ? 1 : -1));

  const [recs] = await Promise.all([getStudyRecommendations(user.id)]);
  const mcqCount = (await svc.from("mcq_attempts").select("id", { count: "exact", head: true }).eq("student_id", user.id)).count ?? 0;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 980 }}>
      <div className="learn-hero" style={{ marginBottom: 18 }}>
        <span className="badge">📥 Inbox</span>
        <h1>Inbox</h1>
        <p className="meta">Your questions, answers, checked papers and performance — all in one place. Use folders to organise.</p>
      </div>
      <InboxView messages={messages} performance={{ mcqCount, paperCount: (subs ?? []).length }} recs={recs} />
    </section>
  );
}
