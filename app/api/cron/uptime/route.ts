import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailShell, emailConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// IS THE SITE UP? TELL HIM THE MOMENT IT IS NOT.
//
// The doubt log threw on every render for an hour and nobody knew until he
// tried to open it. Vercel had recorded 102 identical errors; nothing looked at
// them and nothing said a word.
//
// So the pages that matter are fetched from outside, every few minutes, and a
// failure becomes an email rather than a log line nobody reads.
//
// Deliberately quiet about it:
//   • Only pages a student or the founder actually opens.
//   • A page must fail TWICE in a row before anybody is told — one timeout in
//     the night is a blip, and an alarm that cries wolf gets filtered.
//   • One email per outage, not one per check. A second only when it recovers.
//
// This runs on Vercel, so it cannot detect Vercel being wholly down — nothing
// hosted here could. It catches what actually happens: a page that throws, a
// deploy that broke a route, a database that stopped answering.

const WATCH = [
  { path: "/", what: "The homepage" },
  { path: "/login", what: "Sign in" },
  { path: "/pricing", what: "Pricing" },
  { path: "/courses", what: "Courses" },
  { path: "/admin/doubt-log", what: "The doubt report" },
  { path: "/admin/orders", what: "Sales & orders" },
];

const ALERT_TO = "ps.smay@gmail.com";
const STATE_KEY = "uptime_state";

type State = Record<string, { fails: number; alerted: boolean }>;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const base = (await getSecret("SITE_URL")) || "https://caparveensharma.com";
  const svc = createServiceClient();

  const { data: row } = await svc
    .from("site_settings").select("value").eq("key", STATE_KEY).maybeSingle();
  let state: State = {};
  try { state = JSON.parse(String(row?.value ?? "{}")) as State; } catch { state = {}; }

  const broken: { what: string; path: string; why: string }[] = [];
  const recovered: string[] = [];
  const checked: { path: string; status: number | string }[] = [];

  for (const page of WATCH) {
    const prev = state[page.path] ?? { fails: 0, alerted: false };
    let why = "";

    try {
      const res = await fetch(`${base}${page.path}`, {
        redirect: "manual",          // a redirect to /login is a healthy answer
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": "caparveensharma-uptime" },
      });
      checked.push({ path: page.path, status: res.status });
      // Anything below 500 means the site answered. A 401 or a redirect is the
      // app working correctly, not an outage.
      if (res.status >= 500) why = `returned ${res.status}`;
    } catch (e) {
      checked.push({ path: page.path, status: "no answer" });
      why = e instanceof Error && /timeout|abort/i.test(e.message) ? "did not answer in 20 seconds" : "could not be reached";
    }

    if (why) {
      const fails = prev.fails + 1;
      // Twice in a row before anybody is woken.
      if (fails >= 2 && !prev.alerted) {
        broken.push({ what: page.what, path: page.path, why });
        state[page.path] = { fails, alerted: true };
      } else {
        state[page.path] = { fails, alerted: prev.alerted };
      }
    } else {
      if (prev.alerted) recovered.push(page.what);
      state[page.path] = { fails: 0, alerted: false };
    }
  }

  if ((broken.length || recovered.length) && (await emailConfigured())) {
    const subject = broken.length
      ? `🔴 caparveensharma.com — ${broken.map((b) => b.what).join(", ")} is down`
      : `🟢 caparveensharma.com — back up`;
    const body = broken.length
      ? `<p><strong>These pages are failing right now:</strong></p><ul>` +
        broken.map((b) => `<li><strong>${b.what}</strong> (${b.path}) — ${b.why}</li>`).join("") +
        `</ul><p>Checked twice before sending, so this is not a blip. You will get one more email when it recovers.</p>`
      : `<p><strong>${recovered.join(", ")}</strong> is answering normally again.</p>`;

    await sendEmail(ALERT_TO, subject, emailShell(subject, body)).catch(() => false);
  }

  await svc.from("site_settings")
    .upsert({ key: STATE_KEY, value: JSON.stringify(state) }, { onConflict: "key" });

  return NextResponse.json({ ok: true, checked, broken, recovered });
}
