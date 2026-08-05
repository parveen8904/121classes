import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Take the cold start off the first student after a deploy.
//
// Every deploy throws away the cached copy of every page. The first person to
// open one waits for it to be built from scratch — compile, render, query —
// and that measured SIXTY-SEVEN SECONDS on /articles this morning. The second
// visitor gets it in a tenth of a second. With ten thousand students, "the
// first visitor" is a real student, several times a day.
//
// So the first visitor is us. This runs often, does nothing at all while the
// deployment is unchanged, and when it sees a new one it fetches the pages
// students actually land on, so their copies are already warm.
//
// It is deliberately NOT off-peak-gated: a deploy in the middle of the evening
// is exactly when this matters most, and a page fetch is nothing like the load
// of the migration jobs that rule protects.

// Where students arrive. Ordered by who lands there first, because the budget
// runs out before the list does on a slow build.
const ROUTES = [
  "/",
  "/login",
  "/ask",
  "/courses",
  "/pricing",
  "/test-series",
  "/dashboard",
  "/articles",
  "/results",
  "/faculty",
  "/books",
  "/calendar",
  "/placements",
  "/career",
  "/amendments",
  "/notes",
  "/support",
  "/gift",
  "/scholarship",
];

const ORIGIN = "https://caparveensharma.com";
const MARKER = "warm_deploy_id";

function deploymentId(): string {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_URL ||
    "local"
  );
}

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const current = deploymentId();
  const force = params.get("force") === "1";

  // The common case, hundreds of times a day: nothing has changed, so this
  // returns without touching a single page.
  const { data: saved } = await svc
    .from("site_settings")
    .select("value")
    .eq("key", MARKER)
    .maybeSingle();
  if (!force && String(saved?.value ?? "") === current) {
    return NextResponse.json({ ok: true, result: "already-warm", deployment: current });
  }

  // Claim it FIRST. Two crons can overlap on a slow build, and warming every
  // page twice is worse than not warming it at all.
  await svc.from("site_settings").upsert({ key: MARKER, value: current });

  const started = Date.now();
  const BUDGET = 100_000;
  const warmed: string[] = [];
  const slow: string[] = [];
  const failed: string[] = [];

  // Three at a time. Enough to get through the list quickly, few enough that
  // the warming itself is never what makes the site slow.
  const queue = [...ROUTES];
  async function worker() {
    for (;;) {
      const path = queue.shift();
      if (!path || Date.now() - started > BUDGET) return;
      const t0 = Date.now();
      try {
        const res = await fetch(`${ORIGIN}${path}`, {
          cache: "no-store",
          redirect: "manual",
          headers: { "user-agent": "caparveensharma-warmup" },
        });
        // A redirect is a warm route too — /dashboard sends a logged-out
        // visitor to /login, and the work we wanted done is already done.
        const ms = Date.now() - t0;
        if (res.status < 500) {
          warmed.push(path);
          if (ms > 3000) slow.push(`${path} ${(ms / 1000).toFixed(1)}s`);
        } else {
          failed.push(`${path} ${res.status}`);
        }
      } catch (e) {
        failed.push(`${path} ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  // Say which pages were slow even when everything succeeded. A route that
  // takes twelve seconds to build is worth knowing about, and this is the one
  // place that measures every page on every deploy.
  if (slow.length) console.warn("[warm] slow to build:", slow.join(", "));

  return NextResponse.json({
    ok: true,
    deployment: current,
    warmed: warmed.length,
    tookMs: Date.now() - started,
    slow,
    failed,
  });
}
