import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { selectAll } from "@/lib/pageAll";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE STUDENTS WHO SAID THEY CANNOT GET IN.
//
// About 1,600 people hold an account with no password on it — access granted in
// bulk in early August, a set-password link emailed on the day, and a recovery
// link does not last. But most of them have not tried to log in yet, and when
// they do the login screen now sends them the link by itself. Writing to all
// 1,600 would be a mailshot to people with no problem.
//
// So this writes to the ones who have actually said something: a login-help
// request, or a ticket about signing in. They tried, they failed, they told us,
// and some of them are still locked out days later.
//
//   GET  /api/cron/locked-out?key=…            → who, and why. Sends nothing.
//   GET  /api/cron/locked-out?key=…&send=1     → sends them one link each.
//
// Deliberately not on a schedule. `login_link_sent_at` is stamped as each mail
// goes out, so running it twice never writes to the same person twice.

const SINCE_DAYS = 21;
const PER_RUN = 300;

/** Any email address inside a line of text — students type theirs into tickets. */
const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const ABOUT_LOGIN = /(log ?in|login|sign ?in|password|cannot access|can'?t access)/i;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const send = params.get("send") === "1";
  const svc = createServiceClient();
  const since = new Date(Date.now() - SINCE_DAYS * 86_400_000).toISOString();

  // ── Who complained ───────────────────────────────────────────────────────
  const said = new Set<string>();
  const note = (addr?: string | null) => {
    const a = (addr ?? "").trim().toLowerCase();
    // Never our own alert address: the site writes to itself and that is not a
    // student asking for help.
    if (a && a.includes("@") && !a.endsWith("@caparveensharma.com")) said.add(a);
  };

  const { data: asked } = await svc
    .from("page_questions").select("email, page_path, question")
    .gte("created_at", since).limit(2000);
  for (const q of asked ?? []) {
    const text = String(q.question ?? "");
    if (q.page_path !== "login-help" && !ABOUT_LOGIN.test(text)) continue;
    note(q.email as string | null);
    for (const m of text.match(EMAIL_IN_TEXT) ?? []) note(m);
  }

  const { data: raised } = await svc
    .from("tickets").select("student_email, title, description")
    .gte("created_at", since).limit(2000);
  for (const t of raised ?? []) {
    if (!ABOUT_LOGIN.test(`${t.title ?? ""} ${t.description ?? ""}`)) continue;
    note(t.student_email as string | null);
  }

  if (!said.size) return NextResponse.json({ ok: true, complained: 0, would_email: 0 });

  // ── Which of them are still stuck ────────────────────────────────────────
  // Still no password on the account, and not already written to. Somebody who
  // has since chosen a password sorted themselves out and is left alone.
  const rows = await selectAll<{ id: string; email: string | null; full_name: string | null }>(
    (from, to) =>
      svc.from("profiles").select("id, email, full_name")
        .eq("has_password", false)
        .is("login_link_sent_at", null)
        .not("email", "is", null)
        .range(from, to),
  );

  const targets = rows.filter((r) => said.has((r.email ?? "").trim().toLowerCase()));
  // Complained, but no account on that address at all — they never finished
  // registering, and a sign-in link would be no use to them. Named so somebody
  // can tell them to register instead.
  const haveAccount = new Set(rows.map((r) => (r.email ?? "").toLowerCase()));
  const { data: anyProfile } = await svc
    .from("profiles").select("email").in("email", [...said]).limit(1000);
  const registered = new Set((anyProfile ?? []).map((r) => String(r.email ?? "").toLowerCase()));
  const noAccount = [...said].filter((a) => !registered.has(a) && !haveAccount.has(a));

  if (!send) {
    return NextResponse.json({
      ok: true,
      complained: said.size,
      would_email: targets.length,
      to: targets.map((t) => t.email),
      no_account_tell_them_to_register: noAccount,
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

  return NextResponse.json({ ok: true, complained: said.size, sent, failed, no_account: noAccount });
}
