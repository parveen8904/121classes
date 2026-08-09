import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { emailConfigured } from "@/lib/notify";
import { sendTemplate } from "@/lib/emailTemplates";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// THE PEOPLE WHO SIGNED UP AND NEVER GOT IN.
//
// On launch day 288 students registered and 31 of them never clicked the
// confirmation email — evenly spread across every hour, so not an outage,
// simply the ordinary tenth of people whose verification mail is buried,
// filtered, or opened on a phone they were not holding at the time.
//
// They wanted in. They gave us an address. Then nothing followed, because the
// verification email was sent once and never again. So this sends it a second
// time, once, and stops.
//
// Deliberately narrow:
//   • older than an hour — someone mid-signup is not chased mid-signup;
//   • younger than three days — a fortnight-old link arriving out of the blue
//     reads as spam, and by then they have moved on;
//   • never signed in, still unconfirmed — anyone who got in is left alone;
//   • ONCE per person, ever. A second chase is nagging, not helping.

const CHASE_TEMPLATE = "email_verify_resend";
const MIN_AGE_MINUTES = 60;
const MAX_AGE_DAYS = 3;
const CAP = 200;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await emailConfigured())) return NextResponse.json({ ok: true, skipped: "email not configured" });

  const svc = createServiceClient();
  const siteUrl = (await getSecret("SITE_URL")) || "https://caparveensharma.com";

  const now = Date.now();
  const notAfter = new Date(now - MIN_AGE_MINUTES * 60_000);
  const notBefore = new Date(now - MAX_AGE_DAYS * 86_400_000);

  // auth.users is not reachable through PostgREST, so the admin API pages it.
  const stuck: { id: string; email: string }[] = [];
  for (let page = 1; page <= 20 && stuck.length < CAP; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      const made = new Date(u.created_at).getTime();
      if (made > notAfter.getTime() || made < notBefore.getTime()) continue;
      if (u.email_confirmed_at || u.last_sign_in_at) continue;
      if (!u.email) continue;
      stuck.push({ id: u.id, email: u.email });
    }
    if (data.users.length < 200) break;
  }

  if (!stuck.length) return NextResponse.json({ ok: true, chased: 0, found: 0 });

  // Who has already had one. Nobody is chased twice.
  const { data: already } = await svc
    .from("notifications")
    .select("student_id")
    .eq("template", CHASE_TEMPLATE)
    .in("student_id", stuck.map((s) => s.id));
  const done = new Set((already ?? []).map((r) => String(r.student_id)));

  let chased = 0;
  let failed = 0;
  for (const u of stuck) {
    if (done.has(u.id)) continue;
    try {
      const { data, error } = await svc.auth.admin.generateLink({ type: "magiclink", email: u.email });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) { failed++; continue; }

      // On OUR domain, carrying only the token hash — never a raw storage or
      // project URL in a student's inbox.
      const link = `${siteUrl}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/auth/set-password`;
      const sent = await sendTemplate(CHASE_TEMPLATE, u.email, {
        heading: "Finish setting up your account",
        action_url: link,
        action_label: "Verify & sign in",
      });

      // Recorded whether or not it went, so a failure is visible and a success
      // is never repeated.
      await svc.from("notifications").insert({
        student_id: u.id,
        channel: "email",
        template: CHASE_TEMPLATE,
        payload: { to: u.email, reason: "signed up but never verified" },
        status: sent ? "sent" : "skipped",
        sent_at: sent ? new Date().toISOString() : null,
      });
      if (sent) chased++; else failed++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, found: stuck.length, chased, failed });
}
