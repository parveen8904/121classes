import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Email that answers itself.
//
// sir@caparveensharma.com is where students — and anyone else — write, and it
// was the one channel with no brain behind it: Telegram answers, the doubt box
// answers, WhatsApp now answers, email waited for a person. So the promise that
// a student can ask any time was true on three channels out of four.
//
// Mailgun posts every inbound message here. A real question is answered from
// CA Parveen Sharma's own repository and replied to in the same thread. Chatter
// and automated mail are left alone, and anything the material cannot support
// goes to the faculty rather than being invented.
//
// Every message is recorded either way, so nothing is answered invisibly.

/** Mailgun signs each post; an unsigned one is somebody else's. */
async function signatureOk(form: FormData): Promise<boolean> {
  // Mailgun signs webhooks with the account's HTTP webhook signing key, which is
  // NOT the sending key we post mail with. Verifying against the sending key
  // rejects every genuine message as a forgery, so the signing key comes first
  // and the old name stays only as a fallback for setups that never split them.
  const key = (await getSecret("MAILGUN_WEBHOOK_KEY")) || (await getSecret("MAILGUN_API_KEY"));
  if (!key) return false;
  const timestamp = String(form.get("timestamp") ?? "");
  const token = String(form.get("token") ?? "");
  const signature = String(form.get("signature") ?? "");
  if (!timestamp || !token || !signature) return false;

  // Refuse anything more than 5 minutes old — a captured post cannot be replayed.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = createHmac("sha256", key).update(timestamp + token).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Strip the quoted history so the AI answers today's question, not the thread. */
function newestPart(body: string): string {
  return body
    .split(/^\s*(On .+wrote:|-{2,}\s*Original Message|_{5,}|From:\s)/m)[0]
    .split(/\n>{1,}/)[0]
    .trim()
    .slice(0, 6000);
}

/** "CA Parveen Sharma <contact+caf_=x@d.com>" → "contact@d.com". */
function bareAddress(s: string): string {
  const a = s.toLowerCase().replace(/^.*</, "").replace(/>.*$/, "").trim();
  const at = a.lastIndexOf("@");
  if (at < 1) return a;
  // Google rewrites a FORWARDED sender to contact+caf_=inbox=121caclasses.com@…
  // Everything after the "+" is routing, not identity, and comparing the whole
  // string meant our own mail was not recognised as ours — which is precisely
  // how the site ended up answering itself thirty times in ten minutes.
  return `${a.slice(0, at).split("+")[0]}@${a.slice(at + 1)}`;
}

/** Our own addresses. Mail from any of these is US, and must never be answered. */
async function isOurOwnMail(from: string): Promise<boolean> {
  const addr = bareAddress(from);
  if (!addr.includes("@")) return false;

  // The whole sending domain counts as us. Address-by-address matching is one
  // rewrite away from failing again, and a member of staff who needs something
  // done has the admin panel rather than the student inbox.
  const ourDomain = (await getSecret("MAILGUN_DOMAIN")).toLowerCase().trim();
  if (ourDomain && addr.endsWith(`@${ourDomain}`)) return true;

  const ours = await Promise.all([
    getSecret("NOTIFY_FROM_EMAIL"),
    getSecret("NOTIFY_REPLY_TO"),
    getSecret("FACULTY_EMAIL"),
  ]);
  return ours.some((o) => o.trim() && bareAddress(o) === addr);
}

/**
 * Last line of defence, whatever the cause.
 *
 * The address checks above answer "is this us?" — but a loop can start any
 * number of ways we have not thought of, and the cost of being wrong is a
 * thousand emails overnight rather than thirty in ten minutes. So: if the same
 * sender has already been recorded many times in the last hour, stop answering
 * and let a person look. This does not need to know WHY it is looping.
 */
async function loopingHard(svc: ReturnType<typeof createServiceClient>, from: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await svc
      .from("page_questions")
      .select("id", { count: "exact", head: true })
      .eq("page_path", "email")
      .eq("email", from)
      .gte("created_at", since);
    // Three, not seven. A student with four genuine questions in one hour is
    // rare; seven automatic replies to somebody in one hour is never right.
    return (count ?? 0) > 3;
  } catch {
    return false;
  }
}

/**
 * "Re: Re: Re: Your first class is waiting" — the shape of a loop.
 *
 * The reply subject used to be `Re: ${subject}` whatever the subject already
 * was, so every turn added another prefix. Anshu Bansal got three in ten
 * minutes and the subject line was keeping count for us: Re: Re:, then
 * Re: Re: Re:.
 *
 * Two things come out of that. A reply now carries exactly ONE "Re:", however
 * many arrived — and an incoming subject that already has two or more is
 * treated as proof of a loop on its own, without waiting for a counter to fill
 * up. Mail conventions differ by language and client, so the Fwd and the
 * Spanish/German forms are recognised too: a loop that speaks another language
 * is still a loop.
 */
const RE_PREFIX = /^\s*((re|aw|sv|antw|res|fwd|fw|wg|tr)\s*(\[\d+\])?\s*:\s*)+/i;

export function replySubject(subject: string, fallback: string): string {
  const bare = subject.replace(RE_PREFIX, "").trim();
  return bare ? `Re: ${bare}` : fallback;
}

/** How many Re:/Fwd: prefixes are already stacked on an arriving subject. */
export function replyDepth(subject: string): number {
  const m = subject.match(RE_PREFIX);
  if (!m) return 0;
  return (m[0].match(/:/g) ?? []).length;
}

/** Mail that must never be replied to: bounces, vacation notices, other robots. */
function isMachineMail(form: FormData, from: string, subject: string): boolean {
  const header = (n: string) => String(form.get(n) ?? "").toLowerCase();
  // Mailgun tags spam rather than blocking it, so a genuine student is never
  // silently dropped — but nothing is auto-answered back to a spammer either.
  if (header("X-Mailgun-Sflag") === "yes") return true;
  if (header("X-Autoreply") || header("Auto-Submitted").includes("auto-")) return true;
  if (header("Precedence").match(/bulk|junk|list/)) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/i.test(from)) return true;
  if (/^(auto|automatic)[\s-]?(reply|response)|out of office|delivery status/i.test(subject)) return true;

  // ANYTHING SENT TO A LIST. A List-Unsubscribe header is the one thing every
  // bulk sender sets and no student ever does — Facebook's notifications and
  // cold marketing both carry it. Four Facebook notices and two identical
  // marketing pitches were sitting in the doubt inbox as open student
  // questions, waiting for somebody to answer them.
  if (header("List-Unsubscribe") || header("List-Id")) return true;

  // Notification senders that are not called "no-reply": Facebook alone writes
  // as notification@, reminders@ and friendsuggestion@.
  const local = from.split("@")[0] ?? "";
  if (/^(notification|notifications|reminder|reminders|friendsuggestion|update|updates|alert|alerts|news|newsletter|digest|mailer|notify|support-noreply|team)$/i.test(local)) return true;

  // Domains that only ever send machine mail.
  const domain = (from.split("@")[1] ?? "").toLowerCase();
  if (/(^|\.)(facebookmail|linkedin|twitter|x|instagram|googlemail-noreply|bounces)\.(com|net)$/i.test(domain)) return true;

  return false;
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: true }); // never make Mailgun retry a malformed post
  }

  if (!(await signatureOk(form))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // WHO HANDED IT OVER vs WHO WROTE IT. On forwarded mail these differ: Google
  // hands it over as contact+caf_=…@caparveensharma.com while the student sits
  // in the From: header. Preferring the envelope meant the reply to a forwarded
  // student went back to ourselves — the student never heard anything, and the
  // reply became the next turn of the loop.
  const envelope = String(form.get("sender") ?? "").trim();
  const headerFrom = String(form.get("from") ?? "").trim();
  const from = bareAddress(headerFrom) || bareAddress(envelope);
  const to = String(form.get("recipient") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const bodyRaw = String(form.get("stripped-text") ?? form.get("body-plain") ?? "").trim();
  const question = newestPart(bodyRaw);

  const svc = createServiceClient();

  // IS THIS EVEN A STUDENT?
  //
  // contact@ is BOTH the address students reply to and the address the site
  // escalates to. Once it forwards in here, our own notifications arrive as
  // inbound mail — "🔔 A student doubt needs your reply", "🔔 9 things need a
  // person" — and the site would answer itself, each answer arriving again.
  // Both sides are checked: the writer AND the machine that handed it over.
  //
  // This is decided BEFORE the row is written, which it was not before. The
  // message was recorded as an OPEN question and only then judged, so every
  // alert the site sent itself sat in the inbox looking like a student waiting
  // for a reply. Forty-one of sixty-five open doubts were our own emails.
  const notFromAStudent =
    !from || !question ||
    isMachineMail(form, from, subject) ||
    (await isOurOwnMail(from)) ||
    (envelope && (await isOurOwnMail(envelope)) && !headerFrom);

  // Still recorded — losing mail is worse than filing it wrongly — but as
  // `ignored`, so it stays out of the queue of people actually waiting.
  const { data: row } = await svc
    .from("page_questions")
    .insert({
      user_id: null,
      email: from || null,
      page_path: "email",
      question: `${subject}\n\n${question}`.trim().slice(0, 8000),
      status: notFromAStudent ? "ignored" : "open",
    })
    .select("id")
    .maybeSingle();

  if (notFromAStudent) {
    return NextResponse.json({ ok: true, result: "recorded as ignored, not a student" });
  }

  // ONE AUTOMATIC ANSWER PER SUBJECT, PER PERSON. EVER.
  //
  // This is the guard that actually holds, and the one I got wrong first time.
  // I made replies normalise to a single "Re:" so the subject would stop
  // growing — and in doing so I disabled my own depth check, because the depth
  // can now never reach two. Anshu Bansal kept receiving replies through it.
  //
  // Depth was the wrong thing to count. What matters is whether we have ALREADY
  // answered this person about this subject: if we have, a further message on
  // the same thread is either our own reply coming back, or a real person who
  // was not helped the first time. Both want a human, and neither wants another
  // robot. So the machine answers a given subject once and then stands aside.
  const subjectKey = subject.replace(RE_PREFIX, "").trim().toLowerCase().slice(0, 120);
  if (subjectKey) {
    const { count: answeredBefore } = await svc
      .from("page_questions")
      .select("id", { count: "exact", head: true })
      .eq("page_path", "email")
      .eq("email", from)
      .eq("status", "answered")
      .ilike("question", `${subjectKey.replace(/[%_]/g, "")}%`);
    if ((answeredBefore ?? 0) > 0) {
      console.error("[email/inbound] already answered", JSON.stringify(subjectKey), "for", from, "— not answering again");
      try {
        const { notifyFaculty } = await import("@/lib/notify");
        await notifyFaculty(
          "🔁 A second message on a thread we already answered",
          `${from} has written again about:\n\n  ${subject.slice(0, 200)}\n\n` +
          `We answered this subject once already and have NOT answered again — either our own reply came back to ` +
          `us, or they were not helped the first time. Please read the thread and reply by hand.`,
        ).catch(() => {});
      } catch { /* telling somebody must not fail the request */ }
      return NextResponse.json({ ok: true, result: "recorded, already answered this subject" });
    }
  }

  // And the stacked-prefix check stays, for clients that keep piling them on.
  if (replyDepth(subject) >= 2) {
    console.error("[email/inbound] subject already stacked —", JSON.stringify(subject.slice(0, 80)), "from", from);
    try {
      const { notifyFaculty } = await import("@/lib/notify");
      await notifyFaculty(
        "🔁 An email loop was stopped",
        `A message arrived from ${from} with the subject:\n\n  ${subject.slice(0, 200)}\n\n` +
        `Two or more "Re:" prefixes means our own reply came back to us and was answered again. ` +
        `Nothing further has been sent to this person automatically — please look at the thread and reply by hand ` +
        `if they are owed an answer.`,
      ).catch(() => {});
    } catch { /* telling somebody must not itself fail the request */ }
    return NextResponse.json({ ok: true, result: "recorded, reply chain too deep" });
  }

  if (await loopingHard(svc, from)) {
    console.error("[email/inbound] too many messages from", from, "— answering stopped");
    return NextResponse.json({ ok: true, result: "recorded, loop guard tripped" });
  }

  // An answer book arrived by email. It is NOT a doubt and must not be answered
  // like one: a paper is marked against CA Parveen Sharma's approved key for
  // that specific test, and nothing in an email says which test it is. Guessing
  // would mean marking from the model's own knowledge — the one thing he ruled
  // out. So it goes to the faculty with the attachment named, and the student
  // is told what happens next.
  const attachmentCount = Number(form.get("attachment-count") ?? 0);
  if (attachmentCount > 0) {
    const names: string[] = [];
    for (let i = 1; i <= attachmentCount; i++) {
      const a = form.get(`attachment-${i}`);
      if (a && typeof a === "object" && "name" in a) names.push(String((a as File).name));
    }
    try {
      const { sendEmail, emailShell, notifyFaculty, aiReplyBcc } = await import("@/lib/notify");
      await sendEmail(
        from,
        replySubject(subject, "Your answer book"),
        emailShell(
          "We have your paper",
          "<p>Thank you — your answer book has reached us and is in the checking queue.</p>" +
            "<p>The fastest route is always the website: take the test at " +
            "<a href='https://caparveensharma.com'>caparveensharma.com</a>, upload your answers as one PDF, and it " +
            "is checked against Sir's own approved answer key with the marks written on your own pages — usually " +
            "back within about two hours.</p>" +
            "<p>If you have not already, please reply telling us <strong>which test</strong> this is, so it is " +
            "marked against the right answer key.</p>",
        ),
        { bcc: await aiReplyBcc() },
      );
      await notifyFaculty(
        "An answer book arrived by email",
        `From: ${from}\nSubject: ${subject}\nAttachments: ${names.join(", ") || attachmentCount}\n\n${question}\n\nOpen it in Mailgun and put it through Admin -> Examiner desk.`,
      );
    } catch (e) {
      console.error("[email/inbound] paper handoff failed", e instanceof Error ? e.message : e);
    }
    if (row?.id) await svc.from("page_questions").update({ status: "open" }).eq("id", row.id);
    return NextResponse.json({ ok: true, result: "paper sent to faculty" });
  }

  try {
    const { isEvaluationComplaint, EVALUATION_HELP } = await import("@/lib/evaluationHelp");
    if (isEvaluationComplaint(question)) {
      const { sendEmail, emailShell, aiReplyBcc } = await import("@/lib/notify");
      await sendEmail(from, replySubject(subject, "Getting your copy checked"),
        emailShell("Getting your copy checked", `<p>${EVALUATION_HELP.replace(/\n\n/g, "</p><p>")}</p>`),
        { bcc: await aiReplyBcc() });
      if (row?.id) await svc.from("page_questions").update({ status: "answered" }).eq("id", row.id);
      return NextResponse.json({ ok: true, result: "evaluation help sent" });
    }
  } catch { /* fall through to the normal answer path */ }

  try {
    const { judgeStudentMessage, answerDoubtFromMaterial, aiConfigured, NEED_FACULTY } = await import("@/lib/ai");
    const judged = await judgeStudentMessage(question);
    if (judged.kind !== "question" || !(await aiConfigured())) {
      await escalate(from, subject, question);
      return NextResponse.json({ ok: true, result: "sent to faculty" });
    }

    // Read WHO is asking before deciding what to answer from. A question about
    // access or money is answered from this student's own record; a question
    // about the subject is answered from the study material. Answering the
    // first from the second is how a student asking "must I pay?" was sent a
    // list of portal features instead.
    const { studentFacts, isAccountQuestion, accountAnswerRules } = await import("@/lib/studentContext");
    const facts = await studentFacts(from);

    let answer: string | null;
    if (isAccountQuestion(question)) {
      answer = await answerDoubtFromMaterial(question, accountAnswerRules(facts));
    } else {
      const { getRepositoryContext } = await import("@/lib/repository");
      const material = await getRepositoryContext(null, 12000, { query: question });
      // Even a study question is better for knowing who asked — it is their name
      // on the reply and their course that decides what is relevant.
      const who = facts.lines.length ? `ABOUT THE STUDENT WHO ASKED:\n${facts.lines.join("\n")}\n\n` : "";
      answer = await answerDoubtFromMaterial(question, who + material);
    }

    if (!answer || answer.trim() === NEED_FACULTY) {
      await escalate(from, subject, question);
      return NextResponse.json({ ok: true, result: "sent to faculty" });
    }

    const { sendEmail, emailShell, aiReplyBcc } = await import("@/lib/notify");
    const html = emailShell(
      subject || "Your question",
      answer
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
        .join("") +
        `<p class="muted">Reply to this email if anything is still unclear — it comes straight back to us.</p>`,
    );
    // He is blind-copied on every answer sent in his name, so nothing goes out
    // in his voice that he has not seen. The student never knows he was copied.
    const sent = await sendEmail(from, replySubject(subject, "Your question"), html, {
      bcc: await aiReplyBcc(),
    });

    if (row?.id) {
      await svc.from("page_questions").update({ status: sent ? "answered" : "open" }).eq("id", row.id);
    }
    return NextResponse.json({ ok: true, result: sent ? "answered" : "send failed" });
  } catch (e) {
    console.error("[email/inbound] could not answer", e instanceof Error ? e.message : e);
    await escalate(from, subject, question).catch(() => {});
    return NextResponse.json({ ok: true, result: "error, sent to faculty" });
  }
}

async function escalate(from: string, subject: string, question: string): Promise<void> {
  const { notifyFaculty } = await import("@/lib/notify");
  await notifyFaculty(
    "A student email needs your reply",
    `From: ${from}\nSubject: ${subject}\n\n${question}\n\nReply from Admin → Messages → Inbox.`,
  );
}
