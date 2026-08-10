import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { selectAll } from "@/lib/pageAll";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE STUDENTS WHO HOLD AN ACCOUNT THEY HAVE NEVER BEEN ABLE TO OPEN.
//
// Access was granted in bulk between the 1st and the 6th of August. Each of
// them was emailed a set-password link on the day; a recovery link does not
// last, and 1,589 of them never opened it. Then the classes were announced and
// they arrived at the login screen with an email address, no password, and a
// message telling them their details did not match.
//
// This sends each of them one fresh link. It is deliberately NOT on a schedule
// and NOT automatic: it is a large piece of post going out over his name, and
// the decision to send it is his. Called with nothing, it only counts.
//
//   GET  /api/cron/locked-out?key=…            → how many, and who (a sample)
//   GET  /api/cron/locked-out?key=…&send=1     → actually sends, in batches
//
// One address is never written to twice: `login_link_sent_at` is stamped as
// each goes out, so a second run picks up only whoever was missed.

const PER_RUN = 300;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const send = params.get("send") === "1";
  const svc = createServiceClient();

  // Who: has an account, has never chosen a password, and has never once been
  // signed in. A student who set a password and forgot it is a different
  // problem with a different answer, and is not written to here.
  const rows = await selectAll<{ id: string; email: string | null; full_name: string | null }>(
    (from, to) =>
      svc.from("profiles").select("id, email, full_name")
        .eq("has_password", false)
        .is("login_link_sent_at", null)
        .not("email", "is", null)
        .range(from, to),
  );

  // …and has never once been signed in. That fact lives in auth.users, which
  // is not reachable over the API, so the database answers it for us.
  const { data: signedIn, error: rpcErr } = await svc.rpc("never_signed_in_ids");
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  const neverIn = new Set<string>(((signedIn ?? []) as { id: string }[]).map((r) => r.id));

  const targets = rows.filter((r) => r.email && neverIn.has(r.id));

  if (!send) {
    return NextResponse.json({
      ok: true,
      would_email: targets.length,
      sample: targets.slice(0, 5).map((t) => t.email),
      note: "Nothing has been sent. Add &send=1 to send.",
    });
  }

  const { sendAccessLink } = await import("@/lib/loginRescue");
  let sent = 0, failed = 0;
  for (const t of targets.slice(0, PER_RUN)) {
    const r = await sendAccessLink(t.email!, t.full_name ?? undefined).catch(() => null);
    if (r?.sent) {
      sent++;
      // Stamped one at a time, as each goes out. A crash halfway through must
      // not re-send to everybody who already received it.
      await svc.from("profiles").update({ login_link_sent_at: new Date().toISOString() }).eq("id", t.id);
    } else {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, sent, failed, remaining: Math.max(0, targets.length - PER_RUN) });
}
