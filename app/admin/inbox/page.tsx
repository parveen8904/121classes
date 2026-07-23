import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import AdminHero from "../_components/AdminHero";
import { markQuestionDone, replyToQuestion } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox — Admin" };

type Question = {
  id: string;
  email: string | null;
  page_path: string | null;
  question: string;
  status: string;
  created_at: string;
  user_id: string | null;
};
type Reminder = {
  id: string;
  email: string | null;
  session_id: string | null;
  created_at: string;
};

function fmt(s: string): string {
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default async function AdminInbox() {
  const svc = createServiceClient();
  const [{ data: qData }, { data: rData }, { data: sessions }] = await Promise.all([
    svc.from("page_questions").select("id, email, page_path, question, status, created_at, user_id").order("created_at", { ascending: false }).limit(200),
    svc.from("class_reminders").select("id, email, session_id, created_at").order("created_at", { ascending: false }).limit(500),
    svc.from("live_sessions").select("id, title"),
  ]);
  // Exclude linked reply rows (page_path "reply:<id>") — those are answers, not questions.
  const questions = ((qData ?? []) as Question[]).filter((q) => !(q.page_path ?? "").startsWith("reply:"));
  const reminders = (rData ?? []) as Reminder[];
  const titleOf = new Map((sessions ?? []).map((s) => [s.id, s.title as string]));
  const openCount = questions.filter((q) => q.status === "open").length;

  // group reminders by session
  const bySession = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const k = r.session_id ?? "general";
    if (!bySession.has(k)) bySession.set(k, []);
    bySession.get(k)!.push(r);
  }

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📥 Inbox"
        title="Inbox"
        subtitle="Student questions and class reminders. Reply or mark done. ✅"
        back={{ href: "/admin", label: "Admin" }}
      />
      <p className="muted" style={{ marginBottom: 24, marginTop: 16 }}>
        Questions from the &ldquo;Ask me&rdquo; button and &ldquo;Notify me&rdquo; sign-ups.
      </p>

      <h2 style={{ fontSize: "1.1rem" }}>💬 Questions {openCount > 0 && <span className="badge">{openCount} open</span>}</h2>
      {questions.length === 0 ? (
        <p className="muted">No questions yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {questions.map((q) => (
            <div className="card" key={q.id} style={{ borderColor: q.status === "open" ? "var(--accent)" : "var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: ".8rem" }}>
                  {q.email || (q.user_id ? "Registered student" : "Anonymous")} · {fmt(q.created_at)}
                  {q.page_path ? ` · ${q.page_path}` : ""}
                </span>
                <form action={markQuestionDone} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="status" value={q.status === "open" ? "done" : "open"} />
                  <SubmitButton className="btn small secondary">
                    {q.status === "open" ? "Mark done" : "Reopen"}
                  </SubmitButton>
                </form>
              </div>
              <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{q.question}</p>
              <details style={{ marginTop: 8 }}>
                <summary className="btn small secondary as-btn">✍️ Reply</summary>
                <form action={replyToQuestion} style={{ marginTop: 8 }}>
                  <input type="hidden" name="id" value={q.id} />
                  <textarea name="reply" rows={3} required placeholder="Type your reply — sent to the student by Telegram (if connected) or email…" />
                  <SubmitButton className="btn small" style={{ marginTop: 6 }}>Send reply</SubmitButton>
                </form>
                {!q.email && !q.user_id && (
                  <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>⚠️ No email/account on this question — can&apos;t deliver a reply.</p>
                )}
              </details>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: "1.1rem", marginTop: 36 }}>🔔 &ldquo;Notify me&rdquo; sign-ups</h2>
      {reminders.length === 0 ? (
        <p className="muted">No reminder sign-ups yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {[...bySession.entries()].map(([sid, list]) => (
            <div className="card" key={sid}>
              <strong>{sid === "general" ? "General / no specific class" : titleOf.get(sid) || "Class"}</strong>{" "}
              <span className="badge">{list.length}</span>
              <p className="muted" style={{ fontSize: ".82rem", marginTop: 8, wordBreak: "break-word" }}>
                {list.map((r) => r.email).filter(Boolean).join(", ") || "(registered students)"}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
