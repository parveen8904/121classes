import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// EVERYONE WHO HAS AN ACCOUNT AND HAS NEVER ONCE BEEN INSIDE IT.
//
// There turned out to be two ways to end up here and they were being handled
// by two different systems, with people falling between them:
//
//   · 104 signed up and never confirmed their email. The verification mail went
//     to spam or was never understood to be a second step. Their password is
//     fine; no amount of retyping moves them, because they are stuck earlier.
//     From the outside this reads as "a hundred students with login problems"
//     and it is not a login problem at all.
//
//   · The bulk-granted accounts — created for people who had bought elsewhere,
//     with no password ever set. 85 of them were made on 1 August alone. A
//     catch-up existed for these but had to be triggered by hand and never was.
//
// The remedy is identical in both cases, which is why they are now one job: a
// recovery link confirms the address AND sets a password in a single step. So
// the reason somebody is outside no longer decides whether anybody writes to
// them.
//
// One the day after, one more three days later, then never again. Two is a
// hand held out; a third is pestering somebody who has decided against us.

// Paced deliberately. There are 1,620 accounts that have never been signed
// into, most of them granted in bulk at launch; sending to all of them at once
// would look like a blast to a mail provider and get the domain marked down,
// which would cost every student their password mail. 40 a run, three runs a
// day, is a fortnight of steady catching up and no spike.
const MAX_PER_RUN = 40;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // Everyone who has an account, has never confirmed, and has never been in.
  const { data: users, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const now = Date.now();
  const stuck = (users?.users ?? []).filter((u) => {
    // The one thing that matters: they have never been inside. Whether the
    // email was confirmed is a detail of HOW they got stuck, not of whether
    // they need a hand.
    if (u.last_sign_in_at) return false;
    if (!u.email) return false;
    const age = now - new Date(u.created_at).getTime();
    // Not in the first few hours — they may still have the tab open, and an
    // email landing on top of the one they already have is noise.
    return age > 6 * 3600_000;
  });

  // Who has already had one, and how many.
  const ids = stuck.map((u) => u.id);
  const sentBefore = new Map<string, number>();
  if (ids.length) {
    const { data: log } = await svc
      .from("notifications").select("student_id")
      .eq("template", "stuck_at_signup").in("student_id", ids).limit(5000);
    for (const r of (log ?? []) as { student_id: string }[]) {
      sentBefore.set(r.student_id, (sentBefore.get(r.student_id) ?? 0) + 1);
    }
  }

  const due = stuck.filter((u) => {
    const already = sentBefore.get(u.id) ?? 0;
    if (already >= 2) return false;                       // two is enough
    const age = now - new Date(u.created_at).getTime();
    if (already === 0) return age > 6 * 3600_000;         // the day after
    return age > 3 * 86400_000;                           // and once more at three days
  }).slice(0, MAX_PER_RUN);

  if (params.get("dry") === "1") {
    return NextResponse.json({
      ok: true, stuck: stuck.length, due: due.length,
      sample: due.slice(0, 20).map((u) => ({ email: u.email, created: u.created_at, already: sentBefore.get(u.id) ?? 0 })),
    });
  }

  const { sendAccessLink } = await import("@/lib/loginRescue");
  let sent = 0;
  const failed: string[] = [];
  for (const u of due) {
    try {
      const r = await sendAccessLink(u.email!);
      if (r.sent) {
        sent++;
        // Logged so the second one can be spaced and the third never happens.
        await svc.from("notifications").insert({
          student_id: u.id, channel: "email", template: "stuck_at_signup",
          payload: { attempt: (sentBefore.get(u.id) ?? 0) + 1 },
          status: "sent", sent_at: new Date().toISOString(),
        });
      } else {
        failed.push(`${u.email}: ${r.note}`);
      }
    } catch (e) {
      failed.push(`${u.email}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({ ok: true, stuck: stuck.length, due: due.length, sent, failedCount: failed.length, failed: failed.slice(0, 10) });
}
