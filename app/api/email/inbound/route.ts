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
  const key = await getSecret("MAILGUN_API_KEY");
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

/** Mail that must never be replied to: bounces, vacation notices, other robots. */
function isMachineMail(form: FormData, from: string, subject: string): boolean {
  const header = (n: string) => String(form.get(n) ?? "").toLowerCase();
  if (header("X-Autoreply") || header("Auto-Submitted").includes("auto-")) return true;
  if (header("Precedence").match(/bulk|junk|list/)) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/i.test(from)) return true;
  if (/^(auto|automatic)[\s-]?(reply|response)|out of office|delivery status/i.test(subject)) return true;
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

  const from = String(form.get("sender") ?? form.get("from") ?? "").trim();
  const to = String(form.get("recipient") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const bodyRaw = String(form.get("stripped-text") ?? form.get("body-plain") ?? "").trim();
  const question = newestPart(bodyRaw);

  const svc = createServiceClient();

  // On the record before anything else happens to it.
  const { data: row } = await svc
    .from("page_questions")
    .insert({
      user_id: null,
      email: from || null,
      page_path: "email",
      question: `${subject}\n\n${question}`.trim().slice(0, 8000),
      status: "open",
    })
    .select("id")
    .maybeSingle();

  if (!from || !question || isMachineMail(form, from, subject)) {
    return NextResponse.json({ ok: true, result: "recorded, not answered" });
  }

  try {
    const { judgeStudentMessage, answerDoubtFromMaterial, aiConfigured, NEED_FACULTY } = await import("@/lib/ai");
    const judged = await judgeStudentMessage(question);
    if (judged.kind !== "question" || !(await aiConfigured())) {
      await escalate(from, subject, question);
      return NextResponse.json({ ok: true, result: "sent to faculty" });
    }

    const { getRepositoryContext } = await import("@/lib/repository");
    const material = await getRepositoryContext(null, 12000, { query: question });
    const answer = await answerDoubtFromMaterial(question, material);
    if (!answer || answer.trim() === NEED_FACULTY) {
      await escalate(from, subject, question);
      return NextResponse.json({ ok: true, result: "sent to faculty" });
    }

    const { sendEmail, emailShell } = await import("@/lib/notify");
    const html = emailShell(
      subject || "Your question",
      answer
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
        .join("") +
        `<p class="muted">Reply to this email if anything is still unclear — it comes straight back to us.</p>`,
    );
    const sent = await sendEmail(from, subject ? `Re: ${subject}` : "Your question", html);

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
