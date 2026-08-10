import { formatDateTime } from "@/lib/dates";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendEmail } from "@/lib/notify";
import { loadTemplate, renderTemplate } from "@/lib/emailTemplates";
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
      ? formatDateTime(s.starts_at)
      : "soon";
    // The wording is loaded and rendered ONCE, not once per student — this can
    // go to a whole batch.
    const { subject, html } = renderTemplate(await loadTemplate("class_reminder"), {
      heading: `Reminder: ${s.title} is starting soon`,
      title: s.title,
      when,
      action_url: s.join_url || undefined,
      action_label: "Join the class →",
    });
    for (const to of emails) {
      if (await sendEmail(to, subject, html)) emailed++;
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
