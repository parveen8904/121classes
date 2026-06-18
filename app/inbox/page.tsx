import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getStudyRecommendations } from "@/lib/recommend";
import { getSubjModelAnswers } from "@/lib/answers";
import { shareToCommunity, shareToTelegram } from "./actions";
import PaperTools from "./PaperTools";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Questions — 121 CA Classes" };

type Entry = { when: string; question: string; answers: { text: string; kind: string }[]; status: string };

function fmt(s: string): string {
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default async function StudentInbox() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/inbox");

  const svc = createServiceClient();
  const [{ data: pq }, { data: doubts }] = await Promise.all([
    svc.from("page_questions").select("id, question, page_path, status, created_at").eq("user_id", user.id).order("created_at", { ascending: true }),
    svc.from("doubts").select("id, question, ai_answer, status, created_at").eq("student_id", user.id).order("created_at", { ascending: true }),
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

  const entries: Entry[] = [];
  for (const r of pq ?? []) {
    if ((r.page_path ?? "").startsWith("reply:")) continue;
    entries.push({ when: r.created_at, question: r.question, answers: replies.get(r.id) ?? [], status: r.status });
  }
  for (const d of doubts ?? []) {
    entries.push({
      when: d.created_at,
      question: d.question,
      answers: d.ai_answer ? [{ text: d.ai_answer, kind: "answer" }] : [],
      status: d.status,
    });
  }
  entries.sort((a, b) => (a.when < b.when ? 1 : -1));

  const recs = await getStudyRecommendations(user.id);

  // Checked papers (graded subjective submissions) + a performance snapshot.
  const { data: subs } = await svc
    .from("subjective_submissions")
    .select("id, question_id, answer_text, ai_score, ai_feedback, status, created_at")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const subQIds = [...new Set((subs ?? []).map((s) => s.question_id))];
  const { data: subQs } = subQIds.length
    ? await svc.from("subjective_questions").select("id, prompt, max_marks").in("id", subQIds)
    : { data: [] as { id: string; prompt: string; max_marks: number | null }[] };
  const qMap = new Map((subQs ?? []).map((q) => [q.id, q]));
  const modelAnswers = await getSubjModelAnswers(subQIds);
  const { data: mcq } = await svc
    .from("mcq_attempts")
    .select("score, total")
    .eq("student_id", user.id);
  const mcqCount = (mcq ?? []).length;
  const paperCount = (subs ?? []).length;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <div className="learn-hero">
        <span className="badge">📨 My Questions</span>
        <h1>My questions &amp; answers</h1>
        <p className="meta">Everything you&apos;ve asked — doubts, and questions about the portal — with the replies. Follow up anytime.</p>
      </div>

      {recs && (recs.topics.length > 0 || recs.material.length > 0) && (
        <div className="card" style={{ marginTop: 18, borderColor: "var(--accent)" }}>
          <h3 style={{ margin: "0 0 6px" }}>🎯 Recommended for you</h3>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
            Based on your questions, focus on: <strong>{recs.concepts.join(", ")}</strong>.
          </p>
          {recs.topics.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p className="muted" style={{ fontSize: ".8rem", margin: "0 0 4px" }}>📚 Study these (class videos, tests &amp; notes are inside):</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {recs.topics.map((t) => (
                  <Link key={t.id} className="btn small secondary" href={`/learn/topic/${t.id}`}>
                    {t.subject?.title ? `${t.subject.title}: ` : ""}{t.title} →
                  </Link>
                ))}
              </div>
            </div>
          )}
          {recs.material.length > 0 && (
            <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
              📘 Related material: {recs.material.map((m) => m.title).join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* PERFORMANCE SNAPSHOT */}
      {(mcqCount > 0 || paperCount > 0) && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 6px" }}>📊 Performance summary</h3>
          <p className="muted" style={{ fontSize: ".9rem", margin: 0 }}>
            You&apos;ve attempted <strong>{mcqCount}</strong> MCQ test{mcqCount === 1 ? "" : "s"} and{" "}
            <strong>{paperCount}</strong> descriptive paper{paperCount === 1 ? "" : "s"}.
          </p>
          <Link className="btn small" style={{ marginTop: 10 }} href="/learn/performance">
            See full performance &amp; ranking →
          </Link>
        </div>
      )}

      {/* CHECKED PAPERS */}
      {paperCount > 0 && (
        <>
          <h2 style={{ marginTop: 28, fontSize: "1.15rem" }}>📝 Your checked papers</h2>
          <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
            {(subs ?? []).map((s) => {
              const q = qMap.get(s.question_id);
              const mm = q?.max_marks ?? 10;
              const shareText =
                `Question: ${q?.prompt ?? ""}\n\nMy answer: ${s.answer_text}` +
                (typeof s.ai_score === "number" ? `\n\nScore: ${s.ai_score}/${mm}` : "") +
                (s.ai_feedback ? `\n\nFeedback: ${s.ai_feedback}` : "");
              return (
                <div className="card" key={s.id}>
                  <p style={{ fontWeight: 700, margin: 0 }}>{q?.prompt ?? "Question"}</p>
                  {typeof s.ai_score === "number" && (
                    <p className="grad" style={{ fontWeight: 800, marginTop: 6 }}>Score: {s.ai_score}/{mm}</p>
                  )}
                  <p className="muted" style={{ fontSize: ".82rem", marginTop: 8, marginBottom: 2 }}>Your answer:</p>
                  <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{s.answer_text}</p>
                  {s.ai_feedback && (
                    <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "3px solid var(--accent)" }}>
                      <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>📋 Examiner feedback</p>
                      <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{s.ai_feedback}</p>
                    </div>
                  )}
                  <PaperTools
                    suggested={modelAnswers.get(s.question_id)}
                    shareTitle="My CA paper — 121 CA Classes"
                    shareText={shareText}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 style={{ marginTop: 28, fontSize: "1.15rem" }}>💬 Questions &amp; answers</h2>
      {entries.length === 0 ? (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted">You haven&apos;t asked anything yet. Tap the <strong>💬 Ask me</strong> button anywhere to ask a doubt or a question about the portal. ✨</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 22 }}>
          {entries.map((e, i) => (
            <div className="card" key={i}>
              <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>
                You · {fmt(e.when)}
                {e.answers.length === 0 && e.status !== "answered" && (
                  <span className="badge" style={{ marginLeft: 8 }}>⏳ awaiting reply</span>
                )}
              </p>
              <p style={{ marginTop: 6, whiteSpace: "pre-wrap", fontWeight: 600 }}>{e.question}</p>
              {e.answers.map((a, j) => (
                <div key={j} style={{ marginTop: 10, paddingLeft: 12, borderLeft: "3px solid var(--accent)" }}>
                  <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>
                    {a.kind === "reply" ? "💬 Reply from CA Parveen Sharma's team" : "🤖 Answer"}
                  </p>
                  <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{a.text}</p>
                </div>
              ))}
              {e.answers.length === 0 && (
                <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>
                  Sent to the team — you&apos;ll get a reply here soon.
                </p>
              )}
              {(() => {
                const shareText =
                  `Q: ${e.question}` + (e.answers[0] ? `\n\nA: ${e.answers[0].text}` : "");
                return (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <form action={shareToCommunity} style={{ margin: 0 }}>
                      <input type="hidden" name="text" value={shareText} />
                      <button className="btn small secondary" type="submit">📢 Share to community</button>
                    </form>
                    <form action={shareToTelegram} style={{ margin: 0 }}>
                      <input type="hidden" name="text" value={shareText} />
                      <button className="btn small secondary" type="submit">✈️ Share to Telegram</button>
                    </form>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
