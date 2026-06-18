import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <div className="learn-hero">
        <span className="badge">📨 My Questions</span>
        <h1>My questions &amp; answers</h1>
        <p className="meta">Everything you&apos;ve asked — doubts, and questions about the portal — with the replies. Follow up anytime.</p>
      </div>

      {entries.length === 0 ? (
        <div className="card" style={{ marginTop: 22 }}>
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
