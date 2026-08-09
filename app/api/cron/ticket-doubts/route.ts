import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// A TICKET RAISED ON THE WEBSITE IS A DOUBT.
//
// Six of them sat unanswered — one for five days, one from a man asking which
// website to buy the classes from. They were invisible because tickets live in
// their own table with their own page, and the doubt log, which is where
// everything else lands and gets answered, had never heard of them.
//
// PHONE TICKETS ARE LEFT ALONE. The IVR opens one for every call — 688 of them
// — and the team settles those on the call itself. Answering them by email
// afterwards would be noise, and would bury the handful that need somebody.
//
// So: website tickets only, into the same log, answered the same way. The
// ticket keeps its own status so the support page still reads correctly; the
// doubt log is where the reply is written and sent.

const CHANNEL = "website_ticket";

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  const { data: tickets } = await svc
    .from("tickets")
    .select("id, ref, title, description, student_name, student_email, user_id, created_at")
    .eq("source", "website")
    .in("status", ["open", "in_progress"])
    .order("created_at")
    .limit(50);

  if (!tickets?.length) return NextResponse.json({ ok: true, tickets: 0 });

  // Already in the log? The ref is unique and travels in the question, so one
  // ticket can never be logged twice however often this runs.
  const refs = tickets.map((t) => `[${t.ref}]`);
  const { data: known } = await svc
    .from("page_questions")
    .select("question")
    .eq("page_path", CHANNEL)
    .limit(500);
  const seen = new Set(
    (known ?? []).flatMap((r) => refs.filter((ref) => String(r.question ?? "").includes(ref))),
  );

  const ai = await import("@/lib/ai");
  const { getRepositoryContext } = await import("@/lib/repository");
  const configured = await ai.aiConfigured();

  let logged = 0;
  for (const t of tickets) {
    const ref = `[${t.ref}]`;
    if (seen.has(ref)) continue;

    const question = [t.title, t.description].filter(Boolean).join("\n\n").trim();
    if (!question) continue;

    // Distress outranks everything, here as everywhere else. Somebody writing
    // to support at two in the morning may not be writing about the portal.
    const { checkDistress, raiseDistress, DISTRESS_REPLY } = await import("@/lib/distress");
    const distress = await checkDistress(question).catch(() => null);
    if (distress?.distressed) {
      await raiseDistress({
        channel: CHANNEL, question, who: t.student_email ?? t.student_name,
        userId: t.user_id ? String(t.user_id) : null, severe: distress.severe,
      });
      logged++;
      continue;
    }

    let draft: string | null = null;
    if (configured) {
      try {
        const material = await getRepositoryContext(null, 12000, { query: question });
        draft = await ai.answerDoubtFromMaterial(question, material, "doubt", { betaNote: false });
        if (!draft || draft.trim() === ai.NEED_FACULTY) {
          draft = await ai.replyFromSiteMap(question).catch(() => null);
        }
      } catch { /* a ticket with no draft is still worth surfacing */ }
    }

    await svc.from("page_questions").insert({
      user_id: t.user_id ?? null,
      email: t.student_email ?? null,
      page_path: CHANNEL,
      // The ref is what stops this being logged twice, and what lets somebody
      // find the ticket it came from.
      question: `${ref} ${question}${t.student_name ? `\n\n— ${t.student_name}` : ""}`,
      status: "open",
      draft_reply: draft,
      drafted_at: draft ? new Date().toISOString() : null,
    });
    logged++;
  }

  return NextResponse.json({ ok: true, tickets: tickets.length, logged });
}
