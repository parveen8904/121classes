import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFaculty } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE DUTY ROUND — every six hours, four times a day.
//
// The founder's ask: don't just tell me a student is stuck, deal with it. So
// this walks the things that would otherwise sit waiting for a person, settles
// what it can from facts the site already holds, and writes to him ONLY when
// something genuinely needs a human. A quiet round sends no email at all —
// otherwise the report becomes noise and stops being read.

type Handled = { what: string; detail: string };
type Drafted = { what: string; detail: string };
type NeedsHuman = { what: string; detail: string; since: string };

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const handled: Handled[] = [];
  const drafted: Drafted[] = [];
  const needsHuman: NeedsHuman[] = [];

  // ---- 1. Login-help requests ------------------------------------------
  // Close the ones whose student has since signed in; try to solve the rest.
  const { data: openLogin } = await svc
    .from("page_questions")
    .select("id, question, created_at")
    .eq("page_path", "login-help")
    .eq("status", "open")
    .order("created_at");

  for (const row of openLogin ?? []) {
    const q = String(row.question ?? "");
    const email = /tried email:\s*([^\s·]+)/.exec(q)?.[1] ?? "";
    const phone = /WhatsApp:\s*([0-9+]+)/.exec(q)?.[1] ?? "";
    const name = /—\s*([^·]+)·/.exec(q)?.[1]?.trim() ?? "";

    // Already signed in since asking? Close it, tell nobody.
    if (email) {
      const { data: u } = await svc
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (u?.id) {
        const { data: authUser } = await svc.auth.admin.getUserById(String(u.id));
        const last = authUser?.user?.last_sign_in_at ? new Date(authUser.user.last_sign_in_at).getTime() : 0;
        if (last > new Date(String(row.created_at)).getTime()) {
          await svc.from("page_questions").update({ status: "answered" }).eq("id", row.id);
          handled.push({ what: "Login help", detail: `${name || email} got in by themselves — request closed.` });
          continue;
        }
      }
    }

    try {
      const { rescueLogin } = await import("@/lib/loginRescue");
      const r = await rescueLogin({ name, phone, email });
      if (r.handled) {
        await svc.from("page_questions").update({ status: "answered" }).eq("id", row.id);
        handled.push({ what: "Login help", detail: `${name || email}: ${r.note}` });
      } else {
        needsHuman.push({ what: "Login help", detail: `${name || "?"} (${phone || "no phone"}) — ${r.note}`, since: String(row.created_at) });
      }
    } catch {
      needsHuman.push({ what: "Login help", detail: `${name || email} — automatic help failed`, since: String(row.created_at) });
    }
  }

  // ---- 2. Student doubts — ANSWER them, and send ------------------------
  // The founder's instruction changed: doubts are to be solved without waiting
  // for his approval. So a genuine question is answered from HIS OWN material
  // and delivered to the student. Chatter is left alone rather than answered
  // earnestly, and anything abusive gets one plain warning.
  // ONLY today's questions. A student who asked in July has moved on — an
  // answer arriving weeks later is worse than no answer, and it reads as if
  // nobody was paying attention. Anything older is stamped so it is not picked
  // up again, and left in the inbox for a person to close.
  const FRESH_HOURS = 24;
  const freshSince = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();

  const { data: staleOpen } = await svc
    .from("page_questions")
    .select("id")
    .eq("status", "open")
    .neq("page_path", "login-help")
    .is("drafted_at", null)
    .lt("created_at", freshSince)
    .limit(200);
  let tooOld = 0;
  if (staleOpen?.length) {
    await svc
      .from("page_questions")
      .update({ drafted_at: new Date().toISOString() })
      .in("id", staleOpen.map((r) => r.id));
    tooOld = staleOpen.length;
  }

  const { data: openDoubts } = await svc
    .from("page_questions")
    .select("id, question, page_path, created_at, email, user_id")
    .eq("status", "open")
    .neq("page_path", "login-help")
    .is("drafted_at", null)
    .gte("created_at", freshSince)
    .order("created_at")
    .limit(15);

  let ignored = 0;
  let warned = 0;

  for (const d of openDoubts ?? []) {
    try {
      const [{ getRepositoryContext }, ai, { deliverQuestionAnswer }] = await Promise.all([
        import("@/lib/repository"),
        import("@/lib/ai"),
        import("@/lib/answerDelivery"),
      ]);
      const { answerDoubtFromMaterial, aiConfigured, judgeStudentMessage, ABUSE_WARNING, NEED_FACULTY } = ai;
      if (!(await aiConfigured())) break;

      const question = String(d.question ?? "");
      const judged = await judgeStudentMessage(question);

      if (judged.kind === "abusive") {
        await deliverQuestionAnswer(String(d.id), ABUSE_WARNING, { markStatus: "replied" });
        warned++;
        continue;
      }
      if (judged.kind === "chatter") {
        // Nothing to answer. Stamp it so the round does not keep picking it up,
        // and leave it in the inbox in case a person wants to look.
        await svc.from("page_questions").update({ drafted_at: new Date().toISOString() }).eq("id", d.id);
        ignored++;
        continue;
      }

      // Answer ONLY from his material — the same repository path the portal's
      // own doubt answering uses, so a reply cites his classes and notes.
      let material = await getRepositoryContext(null, 24000, { query: question });
      // A doubt asked on the site comes with the account that asked it, so an
      // access question is answered from that student's own record instead of
      // from teaching material that can never settle it.
      const ctx = await import("@/lib/studentContext");
      if (ctx.isAccountQuestion(question)) {
        const facts = d.user_id
          ? await ctx.studentFactsById(String(d.user_id)).catch(() => null)
          : d.email ? await ctx.studentFacts(String(d.email)).catch(() => null) : null;
        if (facts) material = `${ctx.accountAnswerRules(facts)}\n\n---\n\n${material}`;
      }
      const { loggedHistory } = await import("@/lib/conversation");
      const history = d.user_id
        ? await loggedHistory({ channel: String(d.page_path ?? "site"), userId: String(d.user_id), current: question }).catch(() => "")
        : "";
      const answer = await answerDoubtFromMaterial(question, material, "doubt", { betaNote: false, history });

      if (answer && answer.trim() !== NEED_FACULTY) {
        const sent = await deliverQuestionAnswer(String(d.id), answer, { markStatus: "replied" });
        if (sent.delivered) {
          drafted.push({ what: "Doubt answered", detail: String(d.question).slice(0, 70) });
        } else {
          // Written but undeliverable (no Telegram, no email) — keep it for him
          // rather than losing the answer.
          await svc
            .from("page_questions")
            .update({ draft_reply: answer, drafted_at: new Date().toISOString(), status: "open" })
            .eq("id", d.id);
          needsHuman.push({
            what: "Answered but could not be delivered",
            detail: String(d.question).slice(0, 110),
            since: String(d.created_at),
          });
        }
      } else {
        // Would not answer — but the student still hears back. A reply built
        // from what the site actually holds ("the test series is at /test-series",
        // "we do not have that") is worth far more than the silence that used to
        // follow, and the founder is still told to add to it.
        const stopgap = await ai.replyFromSiteMap(question).catch(() => null);
        const text = stopgap ?? ai.PLAIN_FALLBACK;
        const sent = await deliverQuestionAnswer(String(d.id), text, { markStatus: "open" });
        // Left "open" so it stays in his queue, but stamped as touched — the
        // selection above skips anything with drafted_at set, and without this
        // the same student would get the same stopgap every six hours.
        await svc
          .from("page_questions")
          .update({ drafted_at: new Date().toISOString() })
          .eq("id", d.id);
        needsHuman.push({
          what: sent.delivered ? "Doubt answered only in outline — needs your reply" : "Doubt the AI would not answer",
          detail: String(d.question).slice(0, 120),
          since: String(d.created_at),
        });
      }
    } catch {
      needsHuman.push({ what: "Student doubt", detail: String(d.question).slice(0, 120), since: String(d.created_at) });
    }
  }

  // ---- 3. Things only a person can decide ------------------------------
  const [{ count: ticketsOpen }, { count: examinerWaiting }, { count: keysWaiting }] = await Promise.all([
    svc.from("tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
    // The examiner desk works on descriptive_attempts — counting paper_attempts
    // here meant the six-hourly report said "nothing waiting" while answer
    // books actually sat unchecked.
    svc
      .from("descriptive_attempts")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "graded"])
      // NULL review_status means "not even graded yet" — a plain neq would drop
      // those rows, which are exactly the ones needing attention.
      .or("review_status.is.null,review_status.neq.checked"),
    svc.from("item_solutions").select("id", { count: "exact", head: true }).eq("status", "drafted"),
  ]);
  if ((ticketsOpen ?? 0) > 0) needsHuman.push({ what: "Support tickets", detail: `${ticketsOpen} open`, since: "" });
  if ((examinerWaiting ?? 0) > 0) needsHuman.push({ what: "Examiner desk", detail: `${examinerWaiting} answer book(s) waiting`, since: "" });
  if ((keysWaiting ?? 0) > 0) needsHuman.push({ what: "Answer keys", detail: `${keysWaiting} drafted key(s) awaiting your approval`, since: "" });

  // ---- 4. Report — but only if there is something to say ---------------
  if (needsHuman.length || drafted.length) {
    const fmt = (s: string) =>
      s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
    await notifyFaculty(
      drafted.length
        ? `${drafted.length} doubt${drafted.length === 1 ? "" : "s"} answered and sent`
        : `${needsHuman.length} thing${needsHuman.length === 1 ? "" : "s"} need${needsHuman.length === 1 ? "s" : ""} a person`,
      [
        handled.length
          ? `Handled automatically this round (${handled.length}):\n` + handled.map((h) => `  • ${h.what}: ${h.detail}`).join("\n") + "\n"
          : "",
        drafted.length
          ? `Answered from your own repository and sent to the student (${drafted.length}) — Admin → Inbox & doubts to read them:\n` +
            drafted.map((d) => `  • ${d.detail}`).join("\n") + "\n"
          : "",
        ignored || warned || tooOld
          ? `Left alone: ${ignored} message(s) with no real question` +
            (tooOld ? `; ${tooOld} older than a day, not answered` : "") +
            (warned ? `; ${warned} warned for unacceptable language` : "") + "\n"
          : "",
        needsHuman.length ? "Needs you:" : "",
        ...needsHuman.map((n) => `  • ${n.what}: ${n.detail}${n.since ? ` (since ${fmt(n.since)})` : ""}`),
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch(() => false);
  }

  return NextResponse.json({
    ok: true,
    handled: handled.length,
    answered: drafted.length,
    ignored,
    warned,
    tooOld,
    needsHuman: needsHuman.length,
    quiet: needsHuman.length === 0 && drafted.length === 0,
    details: { handled, drafted, needsHuman },
  });
}
