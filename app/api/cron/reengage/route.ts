import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Nightly: DRAFT (never send) re-engagement emails for team review.
//  - never_started: signed up 3+ days ago, zero classes watched.
//  - inactive_14d: has watch history, but nothing in the last 14 days.
// Drafts land in Admin → Re-engagement where the team edits/approves each one;
// only approval sends. One draft per student+kind per 30 days, 20 per kind
// per night.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const qp = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && qp !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const svc = createServiceClient();
  const now = Date.now();
  const d3 = new Date(now - 3 * 86400_000).toISOString();
  const d14 = new Date(now - 14 * 86400_000).toISOString();
  const d30 = new Date(now - 30 * 86400_000).toISOString();

  const { data: profs } = await svc
    .from("profiles")
    .select("id, full_name, email, created_at, role, account_type")
    .eq("role", "student")
    .not("email", "is", null);
  const students = (profs ?? []).filter((p) => p.account_type !== "sponsor");
  const ids = students.map((p) => p.id as string);

  const lastWatch = new Map<string, string>();
  if (ids.length) {
    const { data: watch } = await svc
      .from("class_watch")
      .select("student_id, last_watched_at")
      .in("student_id", ids);
    for (const w of watch ?? []) {
      const cur = lastWatch.get(w.student_id as string);
      const at = (w.last_watched_at as string) ?? "";
      if (!cur || at > cur) lastWatch.set(w.student_id as string, at);
    }
  }

  // Skip anyone who already got a draft of that kind in the last 30 days.
  const { data: recent } = await svc
    .from("reengage_drafts")
    .select("student_id, kind")
    .gte("created_at", d30);
  const recentKeys = new Set((recent ?? []).map((r) => `${r.student_id}:${r.kind}`));

  const firstName = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || "there";
  const drafts: { student_id: string; kind: string; email: string; subject: string; body: string }[] = [];

  const neverStarted = students.filter(
    (p) => (p.created_at as string) < d3 && !lastWatch.has(p.id as string) && !recentKeys.has(`${p.id}:never_started`),
  ).slice(0, 20);
  for (const p of neverStarted) {
    drafts.push({
      student_id: p.id as string,
      kind: "never_started",
      email: p.email as string,
      subject: "Your classes are waiting for you 📚",
      body:
        `Hi ${firstName(p.full_name as string | null)},\n\n` +
        `You created your account on caparveensharma.com a few days ago but haven't started a class yet — everything is ready for you.\n\n` +
        `Here are three free things you can do in the next 10 minutes:\n` +
        `1. Open your first class from the dashboard.\n` +
        `2. Make a FREE day-by-day study plan (Planner) built around your exam date.\n` +
        `3. Try a FREE chapter MCQ test and see where you stand.\n\n` +
        `Login: https://caparveensharma.com/login\n\n` +
        `If anything is confusing or not working, just reply to this email — a real person reads it.\n\n` +
        `Happy studying!\nTeam CA Parveen Sharma`,
    });
  }

  const inactive = students.filter((p) => {
    const lw = lastWatch.get(p.id as string);
    return lw && lw < d14 && !recentKeys.has(`${p.id}:inactive_14d`);
  }).slice(0, 20);
  for (const p of inactive) {
    drafts.push({
      student_id: p.id as string,
      kind: "inactive_14d",
      email: p.email as string,
      subject: "We miss you in class 🙂",
      body:
        `Hi ${firstName(p.full_name as string | null)},\n\n` +
        `It's been a couple of weeks since your last class on caparveensharma.com. Exams don't wait — and small daily steps beat big weekend plans.\n\n` +
        `Pick up where you left off: https://caparveensharma.com/dashboard\n` +
        `Short of time? The Planner can rebuild your day-by-day schedule from today: https://caparveensharma.com/planner\n\n` +
        `If something made you stop — a doubt, a technical problem, anything — reply to this email and we'll sort it out.\n\n` +
        `See you in class!\nTeam CA Parveen Sharma`,
    });
  }

  if (drafts.length) await svc.from("reengage_drafts").insert(drafts);
  return NextResponse.json({ ok: true, drafted: drafts.length, never_started: neverStarted.length, inactive: inactive.length });
}
