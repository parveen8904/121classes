import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailShell, aiReplyBcc } from "@/lib/notify";
import { channelLabel } from "@/lib/aiAnswerLog";
import { inChunks } from "@/lib/pageAll";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// One email a day with everything the AI said in his name, on every channel.
//
// Email replies are blind-copied to him as they go out, but Telegram, WhatsApp,
// Discord and the study groups have no equivalent — an answer went to a student
// in his voice and he had no way of seeing it short of opening the admin. This
// closes that: yesterday's questions and answers, grouped by channel, in full.
//
// It is a record to read, not an alert. A day on which the AI said nothing sends
// nothing — an email that is usually empty stops being opened.

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

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Long answers are trimmed in the email; the full text lives in the doubt log. */
function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    let ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    // An admin may also pull the report on demand from the doubt log, so he can
    // read today's answers without waiting for tomorrow morning's run.
    if (!ok) {
      const { createClient } = await import("@/lib/supabase/server");
      const { data: { user } } = await createClient().auth.getUser();
      if (user) {
        const { data: me } = await createServiceClient()
          .from("profiles").select("role").eq("id", user.id).maybeSingle();
        ok = me?.role === "admin";
      }
    }
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Where it goes: the same address that is blind-copied on email replies, so
  // there is one place to change it. BACKUP_EMAIL is the fallback.
  const to = (await aiReplyBcc()) || (await getSecret("BACKUP_EMAIL"));
  if (!to) return NextResponse.json({ ok: true, skipped: "no address set (AI_REPLY_BCC)" });

  // The last 24 hours, or whatever ?hours= says when run by hand.
  const hours = Math.min(168, Math.max(1, Number(params.get("hours")) || 24));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  const svc = createServiceClient();
  const { data } = await svc
    .from("page_questions")
    .select("id, question, status, page_path, created_at, user_id, email")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(2000);
  const rows = (data ?? []) as Row[];

  // Answers are rows of their own, pointing back at their question.
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

  // Only exchanges where something actually went back to a student. A question
  // nobody answered belongs on the faculty's list, not on this report.
  const answered = questions.filter((q) => (answersFor.get(q.id)?.length ?? 0) > 0);
  if (answered.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: "the AI answered nobody in this period" });
  }

  // Who asked, in one query.
  const ids = [...new Set(answered.map((q) => q.user_id).filter(Boolean))] as string[];
  // In batches: a day of questions can name more people than one URL will hold,
  // and a refused query would leave every name reading "Student".
  const people = await inChunks<{ id: string; full_name: string | null; email: string | null }>(
    ids, (batch) => svc.from("profiles").select("id, full_name, email").in("id", batch),
  );
  const nameOf = new Map(people.map((p) => [p.id, p.full_name || p.email || "Student"]));

  // Grouped by channel, because "what is the WhatsApp bot saying" is the
  // question he actually asks of this report.
  const byChannel = new Map<string, Row[]>();
  for (const q of answered) {
    const label = channelLabel(q.page_path);
    if (!byChannel.has(label)) byChannel.set(label, []);
    byChannel.get(label)!.push(q);
  }
  const channels = [...byChannel.entries()].sort((a, b) => b[1].length - a[1].length);

  const summary = channels.map(([label, qs]) => `${label} ${qs.length}`).join(" · ");

  const blocks = channels.map(([label, qs]) => {
    const items = qs.map((q) => {
      const who = nameOf.get(q.user_id ?? "") ?? q.email ?? "Not a signed-in student";
      const answers = answersFor.get(q.id) ?? [];
      const answerHtml = answers
        .map(
          (a) =>
            `<div style="background:#f1f5f9;border-radius:8px;padding:10px 12px;margin-top:6px;white-space:pre-wrap">${esc(
              clamp(a.question, 1800),
            )}</div>`,
        )
        .join("");
      return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-top:10px">
        <div style="font-size:12px;color:#64748b">${esc(who)} · ${IST(q.created_at)}</div>
        <div style="margin-top:6px;white-space:pre-wrap"><strong>Q.</strong> ${esc(clamp(q.question, 600))}</div>
        ${answerHtml}
      </div>`;
    });
    return `<h3 style="margin:22px 0 0;font-size:15px">${esc(label)} — ${qs.length} answered</h3>${items.join("")}`;
  });

  const unanswered = questions.length - answered.length;
  const html = emailShell(
    "What the AI answered yesterday",
    `<p>${answered.length} question${answered.length === 1 ? "" : "s"} answered in your name over the last ${hours} hours.</p>
     <p style="color:#64748b;font-size:13px">${esc(summary)}${
       unanswered > 0
         ? ` · ${unanswered} more came in that the AI left for a person`
         : ""
     }</p>
     ${blocks.join("")}
     <p style="margin-top:24px"><a href="https://caparveensharma.com/admin/doubt-log">Open the full doubt log</a> — every answer in full, and further back.</p>
     <p style="color:#64748b;font-size:13px">If any answer here is wrong, tell me and it is corrected at the source, not just for that student.</p>`,
  );

  const sent = await sendEmail(to, `🤖 AI answers — ${answered.length} in the last ${hours}h`, html);

  return NextResponse.json({
    ok: true,
    sent,
    to,
    answered: answered.length,
    unanswered,
    channels: channels.map(([label, qs]) => ({ channel: label, answered: qs.length })),
  });
}
