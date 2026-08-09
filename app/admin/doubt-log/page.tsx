import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import SubmitButton from "@/app/components/SubmitButton";
import { addCorrection } from "../ai-training/actions";
import { inChunks } from "@/lib/pageAll";
import { AI_CHANNELS, channelLabel } from "@/lib/aiAnswerLog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Doubt log — Admin" };

// A plain record of what students asked and what the AI answered.
//
// Doubts are answered and sent without waiting for approval now, so the check
// moved AFTER the fact: this is the page to read through and see whether the
// answers are good enough. Question and answer, nothing else — a follow-up
// sits under the question it followed, so a conversation reads in order.

type Row = {
  id: string;
  question: string;
  status: string;
  page_path: string | null;
  created_at: string;
  user_id: string | null;
  email: string | null;
};

const IST = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  });

export default async function DoubtLogPage(props: {
  searchParams: Promise<{ days?: string; channel?: string }>;
}) {
  await assertArea("inbox");
  const { days, channel } = await props.searchParams;
  const windowDays = Math.min(180, Math.max(1, Number(days) || 30));
  // Every channel writes into this one table, so "show me only WhatsApp" is a
  // filter rather than a second page. Same format everywhere, as asked.
  const only = channel && AI_CHANNELS[channel] ? channel : "";

  const svc = createServiceClient();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const { data } = await svc
    .from("page_questions")
    .select("id, question, status, page_path, created_at, user_id, email")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows = (data ?? []) as Row[];

  // A reply is stored as its own row with page_path "reply:<question id>", so
  // pair each answer back to the question it belongs to.
  const answersFor = new Map<string, Row[]>();
  const questions: Row[] = [];
  for (const r of rows) {
    const m = /^reply:(.+)$/.exec(r.page_path ?? "");
    if (m) {
      if (!answersFor.has(m[1])) answersFor.set(m[1], []);
      answersFor.get(m[1])!.push(r);
    } else {
      questions.push(r);
    }
  }

  // Who asked — resolved in one query rather than one per row.
  const ids = [...new Set(questions.map((q) => q.user_id).filter(Boolean))] as string[];
  // In batches: a long day of doubts names more people than one URL will
  // hold, and a refused query would leave every asker unnamed.
  const people = await inChunks<{ id: string; full_name: string | null; email: string | null }>(
    ids, (b) => svc.from("profiles").select("id, full_name, email").in("id", b));
  const nameOf = new Map(people.map((p) => [p.id, p.full_name || p.email || "Student"]));

  // Filtered after pairing: a reply row's page_path is "reply:<id>", never the
  // channel, so filtering in the query would have thrown away every answer.
  const shown = only ? questions.filter((q) => (q.page_path ?? "") === only) : questions;

  const answered = shown.filter((q) => (answersFor.get(q.id)?.length ?? 0) > 0).length;
  const unanswered = shown.length - answered;

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="🗒️ Doubt log"
        title="Every question, and the answer that went back"
        subtitle="Doubts are answered and sent automatically. This is the record to read through afterwards — question and answer, in order, with follow-ups under the question they follow."
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="card" style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "baseline" }}>
        <div><strong style={{ fontSize: "1.5rem" }}>{shown.length}</strong><div className="muted">questions</div></div>
        <div><strong style={{ fontSize: "1.5rem" }}>{answered}</strong><div className="muted">answered</div></div>
        <div><strong style={{ fontSize: "1.5rem" }}>{unanswered}</strong><div className="muted">no answer sent</div></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              className={`btn small ${windowDays === d ? "" : "secondary"}`}
              href={`/admin/doubt-log?days=${d}${only ? `&channel=${only}` : ""}`}
            >
              {d} days
            </Link>
          ))}
          {/* The same report that arrives by email each morning, on demand. */}
          <a
            className="btn small secondary"
            href={`/api/cron/ai-digest?hours=${windowDays * 24}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            ✉️ Email me this
          </a>
        </div>
      </div>

      {/* One row of channels. The counts come from what is already loaded, so the
          chips show where the traffic actually is before he clicks. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <Link className={`btn small ${only ? "secondary" : ""}`} href={`/admin/doubt-log?days=${windowDays}`}>
          All channels ({questions.length})
        </Link>
        {Object.entries(AI_CHANNELS).map(([key, label]) => {
          const n = questions.filter((q) => (q.page_path ?? "") === key).length;
          if (!n && only !== key) return null;
          return (
            <Link
              key={key}
              className={`btn small ${only === key ? "" : "secondary"}`}
              href={`/admin/doubt-log?days=${windowDays}&channel=${key}`}
            >
              {label} ({n})
            </Link>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>Nothing asked here in this period.</p>
      )}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {shown.map((q) => {
          const answers = (answersFor.get(q.id) ?? []).slice().reverse();
          return (
            <div className="card" key={q.id}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong style={{ fontSize: ".9rem" }}>{nameOf.get(q.user_id ?? "") ?? q.email ?? "Student"}</strong>
                <span className="badge">{channelLabel(q.page_path)}</span>
                <span className="muted" style={{ marginLeft: "auto", fontSize: ".8rem" }}>{IST(q.created_at)}</span>
              </div>

              <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                <strong>Q.</strong> {q.question}
              </p>

              {answers.length > 0 ? (
                answers.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      marginTop: 8, background: "var(--bg-soft)", borderRadius: 8, padding: "8px 12px",
                      whiteSpace: "pre-wrap", fontSize: ".9rem", lineHeight: 1.6,
                    }}
                  >
                    <strong>A.</strong> {a.question}
                  </div>
                ))
              ) : (
                <p className="muted" style={{ fontSize: ".85rem", margin: "8px 0 0" }}>
                  {q.status === "open"
                    ? "— no answer sent (left alone as chatter, or still waiting)"
                    : `— no answer recorded (${q.status})`}
                </p>
              )}

              {/* Correcting it HERE, beside the answer that was wrong, is the
                  only moment the founder has both the question and the mistake
                  in front of him. Making him retype them elsewhere is why
                  corrections never got written down. */}
              {answers.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: ".82rem", fontWeight: 700, color: "#b45309" }}>
                    ✏️ That answer is wrong — teach it
                  </summary>
                  <form action={addCorrection} style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <input type="hidden" name="trigger" value={q.question} />
                    <input type="hidden" name="was_answered" value={answers[0].question} />
                    <input type="hidden" name="question_id" value={q.id} />
                    <input type="hidden" name="scope" value="all" />
                    <input type="hidden" name="back" value="/admin/doubt-log" />
                    <textarea
                      name="guidance"
                      rows={3}
                      required
                      placeholder="What should it have said? Write it as an instruction — e.g. “Do not answer this. Say a colleague will confirm today.”"
                    />
                    <div>
                      <SubmitButton className="btn small">🎓 Teach it this</SubmitButton>
                    </div>
                  </form>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
