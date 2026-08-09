import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import SubmitButton from "@/app/components/SubmitButton";
import { addCorrection } from "../ai-training/actions";
import { answerWaiting, closeWaiting, closeAllWaiting } from "./actions";
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

/** "3 hours", "2 days" — a wait said the way a person would say it. */
function howLong(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

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

  // ONE TABLE. ONE LOG.
  //
  // Every door a student can ask through — Telegram, Discord, WhatsApp, email,
  // the site, and the "Ask your doubt" box inside a class — writes here now.
  // Class doubts used to land in their own table, which is why the admin home
  // once showed "5 open doubts" and "8 open questions" as though they were
  // different things. They are read from one place, so the counts cannot
  // disagree and there is nowhere else to look.
  // THE NUMBERS COME FROM THE DATABASE, NOT FROM WHAT WE FETCHED.
  //
  // This page used to count a thousand rows in JavaScript. At launch-day
  // volume that is about a fortnight, and past it the report would have
  // described its first thousand rows as though they were everything — the
  // exact silent truncation that once halved the AI bill, on the one report
  // that must never understate how many students are waiting.
  const [{ data: sum }, { data }] = await Promise.all([
    svc.rpc("doubt_report_summary", { p_days: windowDays, p_channel: only || null }),
    // Still fetched, but only to READ THROUGH — every figure above comes from
    // the summary, so a truncated list can no longer become a wrong total.
    svc.from("page_questions")
      .select("id, question, status, page_path, created_at, user_id, email")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(600),
  ]);

  const S = (sum ?? {}) as {
    total?: number; answered?: number; waiting?: number;
    oldest_wait_mins?: number | null; median_reply_mins?: number | null;
    by_channel?: { channel: string; asked: number; done: number; wait: number }[];
    waiting_list?: { id: string; question: string; channel: string; created_at: string }[];
  };

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

  // THE QUEUE COMES FROM THE SUMMARY, complete and oldest first — not from the
  // page of rows fetched for reading. A student waiting three weeks would have
  // fallen off the end of that page and out of the only list meant to catch
  // them. Their full rows are read back by id so the asker still has a name.
  const waitingIds = (S.waiting_list ?? []).map((w) => w.id);
  const { data: waitingFull } = waitingIds.length
    ? await svc
        .from("page_questions")
        .select("id, question, status, page_path, created_at, user_id, email")
        .in("id", waitingIds)
    : { data: [] as Row[] };
  const byId = new Map((waitingFull ?? []).map((r) => [String((r as Row).id), r as Row]));
  const waitingRows: Row[] = (S.waiting_list ?? []).map((w) =>
    byId.get(w.id) ?? {
      id: w.id, question: w.question, status: "open",
      page_path: w.channel, created_at: w.created_at, user_id: null, email: null,
    });

  // Who asked — resolved in one query rather than one per row, and covering
  // the waiting queue as well as the list being read through.
  const ids = [...new Set([
    ...questions.map((q) => q.user_id),
    ...(waitingFull ?? []).map((q) => (q as Row).user_id),
  ].filter(Boolean))] as string[];
  // In batches: a long day of doubts names more people than one URL will
  // hold, and a refused query would leave every asker unnamed.
  const people = await inChunks<{ id: string; full_name: string | null; email: string | null }>(
    ids, (b) => svc.from("profiles").select("id, full_name, email").in("id", b));
  const nameOf = new Map(people.map((p) => [p.id, p.full_name || p.email || "Student"]));

  // Filtered after pairing: a reply row's page_path is "reply:<id>", never the
  // channel, so filtering in the query would have thrown away every answer.
  const shown = only ? questions.filter((q) => (q.page_path ?? "") === only) : questions;

  // HOW MANY, HOW FAST, AND WHAT IS STILL WAITING.
  //
  // The page used to open with a wall of question-and-answer cards and three
  // bare numbers on top, which answered "what was asked" but never "is anything
  // still sitting there, and for how long" — the thing actually worth knowing
  // when you open it in the morning.
  const now = Date.now();
  const firstReplyAt = (id: string): number | null => {
    const list = answersFor.get(id) ?? [];
    if (!list.length) return null;
    return Math.min(...list.map((a) => new Date(a.created_at).getTime()));
  };

  // DEALT WITH means dealt with, however it happened.
  //
  // Not every answer leaves a paired reply row: login-help requests are settled
  // automatically and marked answered, and older replies pre-date the pairing.
  // Counting only paired rows said 46 were waiting when 6 were — the same kind
  // of overstatement that made this page hard to trust in the first place. A
  // row is waiting only if it is still OPEN and nothing came back.
  const isDone = (q: Row) =>
    firstReplyAt(q.id) !== null || q.status === "answered" || q.status === "replied";

  const answeredRows = shown.filter(isDone);


  const answered = S.answered ?? answeredRows.length;
  const unanswered = S.waiting ?? waitingRows.length;
  const totalAsked = S.total ?? shown.length;

  // Minutes from asking to the first reply, for everything answered.
  const waits = answeredRows
    .filter((q) => firstReplyAt(q.id) !== null)
    .map((q) => (firstReplyAt(q.id)! - new Date(q.created_at).getTime()) / 60000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  const typicalMins = S.median_reply_mins ?? (waits.length ? waits[Math.floor(waits.length / 2)] : null);
  const longestWaitMins = S.oldest_wait_mins ?? (waitingRows.length
    ? (now - new Date(waitingRows[0].created_at).getTime()) / 60000
    : null);

  // Per channel, so it is obvious WHERE the unanswered ones are.
  const byChannel = (S.by_channel ?? []).map((c) => ({
    ch: c.channel, label: channelLabel(c.channel), asked: c.asked, done: c.done, wait: c.wait,
  }));

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="🗒️ Doubt log"
        title="Doubts asked, and answers sent"
        subtitle="How many were asked, how many got an answer, and what is still waiting — then the full question-and-answer record underneath."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* THE ANSWER IN ONE SENTENCE, before any list. */}
      <div className="card" style={{ borderLeft: `4px solid ${unanswered === 0 ? "#16a34a" : "#b45309"}` }}>
        <p style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.7 }}>
          <strong>{totalAsked}</strong> doubt{totalAsked === 1 ? "" : "s"} in the last {windowDays} days
          {only ? ` on ${channelLabel(only)}` : ""}. <strong>{answered}</strong> answered
          {totalAsked > 0 ? ` (${Math.round((answered / totalAsked) * 100)}%)` : ""}.{" "}
          {unanswered === 0 ? (
            <span style={{ color: "#16a34a", fontWeight: 700 }}>Nothing is waiting.</span>
          ) : (
            <span style={{ color: "#b45309", fontWeight: 700 }}>
              {unanswered} still waiting{longestWaitMins != null ? `, the oldest for ${howLong(longestWaitMins)}` : ""}.
            </span>
          )}
        </p>
        {typicalMins != null && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: ".88rem" }}>
            {typicalMins < 2
              ? "Answers go back straight away — typically within a minute of being asked."
              : `A student who gets an answer typically waits ${howLong(typicalMins)}.`}
          </p>
        )}
      </div>

      <div className="card" style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "baseline" }}>
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
          All channels ({totalAsked})
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

      {/* WHAT IS STILL WAITING, oldest first. The only part of this page that
          asks anything of him; everything below it is a record. */}
      {waitingRows.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: ".95rem" }}>⏳ Waiting for an answer ({waitingRows.length})</strong>
            <span className="muted" style={{ fontSize: ".8rem" }}>
              Open a row to reply, or close it if it is not going to be answered.
            </span>
            {/* Everything on this list at once, for the days when it is all
                chatter and none of it is worth opening. */}
            <form action={closeAllWaiting} style={{ marginLeft: "auto" }}>
              <SubmitButton className="btn small secondary" savedLabel="✓ Cleared">
                Close all {waitingRows.length}
              </SubmitButton>
            </form>
          </div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {waitingRows.slice(0, 15).map((q) => {
              const mins = (now - new Date(q.created_at).getTime()) / 60000;
              return (
                <details key={q.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: ".88rem" }}>
                    <span style={{ fontWeight: 700, color: mins > 1440 ? "#b91c1c" : "#b45309", minWidth: 92 }}>
                      {howLong(mins)}
                    </span>
                    <span className="badge">{channelLabel(q.page_path)}</span>
                    <span style={{ flex: 1, minWidth: 200 }}>{q.question.slice(0, 90)}</span>
                    <span className="muted">{nameOf.get(q.user_id ?? "") ?? q.email ?? "—"}</span>
                  </summary>

                  {/* Dismissing was buried inside this expander, so the only
                      visible option was to answer — and some of these will
                      never be answered. It sits on the row now, next to the
                      question, where deciding "not this one" takes one press. */}

                  {/* Answered where it is listed. The inbox used to be a second
                      place to do this, which is how one student came to appear
                      in two queues with two different counts. */}
                  <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontSize: ".88rem" }}>{q.question}</p>
                  <form action={answerWaiting} style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <input type="hidden" name="id" value={q.id} />
                    <textarea name="reply" rows={3} required placeholder="Write the reply that goes to the student…" />
                    <div style={{ display: "flex", gap: 8 }}>
                      <SubmitButton className="btn small">Send reply</SubmitButton>
                    </div>
                  </form>
                  <form action={closeWaiting} style={{ marginTop: 6 }}>
                    <input type="hidden" name="id" value={q.id} />
                    <SubmitButton className="btn small secondary">Not replying to this — close it</SubmitButton>
                  </form>
                </details>
              );
            })}
          </div>
          {waitingRows.length > 15 && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: ".8rem" }}>
              …and {waitingRows.length - 15} more, listed in full below.
            </p>
          )}
        </div>
      )}

      {/* Where the unanswered ones are, so a blocked channel is obvious. */}
      {byChannel.length > 1 && (
        <div className="card" style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "4px 8px" }}>Channel</th>
                <th style={{ padding: "4px 8px" }}>Asked</th>
                <th style={{ padding: "4px 8px" }}>Answered</th>
                <th style={{ padding: "4px 8px" }}>Waiting</th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((c) => (
                <tr key={c.ch} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 8px" }}>{c.label}</td>
                  <td style={{ padding: "4px 8px" }}>{c.asked}</td>
                  <td style={{ padding: "4px 8px" }}>{c.done}</td>
                  <td style={{ padding: "4px 8px", fontWeight: c.wait ? 700 : 400, color: c.wait ? "#b45309" : "inherit" }}>
                    {c.wait || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
