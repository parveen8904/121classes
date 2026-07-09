import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendEmail, emailShell } from "@/lib/notify";
import { runStudyReminders } from "@/lib/studyReminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Emails a reminder for live classes starting within the next ~75 minutes, to
// everyone who tapped "Notify me". Deduped via the notifications log (no schema
// change needed) so a class is only reminded once.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const now = Date.now();
  const soon = new Date(now + 75 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data: sessions } = await svc
    .from("live_sessions")
    .select("id, title, starts_at, join_url, audience")
    .eq("is_published", true)
    .gte("starts_at", nowIso)
    .lte("starts_at", soon);

  let reminded = 0;
  let emailed = 0;

  for (const s of sessions ?? []) {
    // already reminded?
    const { data: marker } = await svc
      .from("notifications")
      .select("id")
      .eq("template", "class_reminder")
      .contains("payload", { session_id: s.id })
      .maybeSingle();
    if (marker) continue;

    const { data: subs } = await svc
      .from("class_reminders")
      .select("email")
      .eq("session_id", s.id)
      .not("email", "is", null);
    const emails = [...new Set((subs ?? []).map((r) => r.email as string).filter(Boolean))];

    const when = s.starts_at
      ? new Date(s.starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "soon";
    const html = emailShell(
      `Reminder: ${s.title} is starting soon`,
      `<p>Your live class <strong>${s.title}</strong> is scheduled for <strong>${when}</strong>.</p>` +
        (s.join_url ? `<p><a href="${s.join_url}">Join the class →</a></p>` : "") +
        `<p>See you there! — CA Parveen Sharma</p>`,
    );
    for (const to of emails) {
      if (await sendEmail(to, `⏰ ${s.title} starts soon`, html)) emailed++;
    }

    // mark as reminded
    await svc.from("notifications").insert({
      student_id: null,
      channel: "email",
      template: "class_reminder",
      payload: { session_id: s.id, recipients: emails.length },
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    reminded++;
  }

  // Also send weekly study-plan nudges (deduped per ISO week per student).
  let study = { sent: 0 };
  try {
    study = await runStudyReminders();
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true, classes_reminded: reminded, emails_sent: emailed, study_reminders: study.sent });
}
