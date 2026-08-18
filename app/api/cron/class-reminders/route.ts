import { formatDateTime, formatTime } from "@/lib/dates";
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

  // ── THE CLASSES THAT ACTUALLY EXIST ──────────────────────────────────────
  //
  // Everything above reads live_sessions, which holds ZERO rows and always has.
  // The real timetable is class_schedule — 22 upcoming Financial Instruments
  // classes — so no student has ever been reminded about a live class here.
  //
  // His instruction today: send to EVERYONE ENROLLED, not only those who pressed
  // "Notify me", and remind TWICE — in the morning so the day gets planned around
  // it, and a quarter of an hour before so they actually join. One reminder an
  // hour ahead did neither: too late to rearrange an evening, too early to act on.
  let scheduled = 0;
  try {
    const nowD = new Date();
    // "Today" in IST, because a class at 6:30 pm belongs to the Indian day, not
    // to whatever day it is on the server.
    const ist = new Date(nowD.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const istHour = ist.getHours();
    const dayEndIst = new Date(ist); dayEndIst.setHours(23, 59, 59, 999);
    const dayEndUtc = new Date(dayEndIst.getTime() - (ist.getTime() - nowD.getTime()));

    const { data: classes } = await svc
      .from("class_schedule")
      .select("id, subject_id, title, class_no, scheduled_at, join_url, status")
      .eq("status", "scheduled")
      .gte("scheduled_at", nowIso)
      .lte("scheduled_at", dayEndUtc.toISOString());

    for (const c of classes ?? []) {
      const startsMs = new Date(c.scheduled_at as string).getTime();
      const minsAway = Math.round((startsMs - now) / 60000);

      // Two moments, and only two. The morning one goes out between 7 and 10,
      // for a class later the same day; the last one in the quarter hour before.
      const kind =
        minsAway <= 20 && minsAway >= 0 ? "final"
        : istHour >= 7 && istHour < 10 && minsAway > 60 ? "morning"
        : null;
      if (!kind) continue;

      // Once per class per kind. The cron runs every 15 minutes, so without this
      // a student would get the same message four times an hour.
      const { data: already } = await svc
        .from("notifications")
        .select("id")
        .eq("template", "class_reminder")
        .contains("payload", { schedule_id: c.id, kind })
        .maybeSingle();
      if (already) continue;

      // EVERYONE WHO PAID FOR THE SUBJECT — not only those who found the button.
      // A student who bought the live batch should not have to subscribe to be
      // told their class is on.
      const { data: paid } = await svc
        .from("subscriptions")
        .select("student_id")
        .eq("subject_id", c.subject_id)
        .eq("status", "active");
      const ids = [...new Set((paid ?? []).map((r) => r.student_id as string).filter(Boolean))];

      const people = ids.length
        ? (await svc.from("profiles").select("id, full_name, email, phone").in("id", ids)).data ?? []
        : [];
      // Plus anyone who asked to be told but has not bought — they are watching
      // for a reason.
      const { data: optIn } = await svc
        .from("class_reminders").select("email").eq("session_id", c.id).not("email", "is", null);
      const extra = [...new Set((optIn ?? []).map((r) => r.email as string))]
        .filter((e) => !people.some((p) => (p as { email?: string }).email === e));

      const whenTxt = formatDateTime(c.scheduled_at as string);
      const timeTxt = formatTime(c.scheduled_at as string);
      const heading = kind === "morning"
        ? `Your live class is today — ${c.title}`
        : `Starting in a few minutes — ${c.title}`;
      const { subject, html } = renderTemplate(await loadTemplate("class_reminder"), {
        heading,
        title: String(c.title ?? "Live class"),
        when: whenTxt,
        action_url: (c.join_url as string) || "https://caparveensharma.com/live",
        action_label: "Join the class →",
      });

      for (const p of people) {
        const em = (p as { email?: string }).email;
        if (em) { if (await sendEmail(em, subject, html)) emailed++; }
        // WhatsApp too, where they will actually see it.
        const ph = String((p as { phone?: string }).phone ?? "").trim();
        if (ph) {
          try {
            const { sendWhatsApp } = await import("@/lib/notify");
            const first = String((p as { full_name?: string }).full_name ?? "").split(" ")[0] || "there";
            await sendWhatsApp(ph, "live_class_today", [first, String(c.title ?? "your live class"), timeTxt]);
          } catch { /* email has gone; never fail the batch on one number */ }
        }
      }
      for (const em of extra) { if (await sendEmail(em, subject, html)) emailed++; }

      await svc.from("notifications").insert({
        student_id: null,
        channel: "email",
        template: "class_reminder",
        payload: { schedule_id: c.id, kind, recipients: people.length + extra.length },
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      scheduled++;
    }
  } catch { /* a reminder failure must never take the whole cron down */ }

  // Also send weekly study-plan nudges (deduped per ISO week per student).
  let study = { sent: 0 };
  try {
    study = await runStudyReminders();
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true, classes_reminded: reminded, live_batch_reminders: scheduled, emails_sent: emailed, study_reminders: study.sent });
}
