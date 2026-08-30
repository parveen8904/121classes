import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The runner's end of the wire.
 *
 * His Mac POLLS this; nothing is ever pushed to it. That is deliberate — a
 * laptop on a home connection has no port anyone can reach, and it should stay
 * that way. It claims one job, works, and posts the answer back.
 *
 *   POST { action: "claim",  runner }              → one job, or null
 *   POST { action: "beat",   id, runner }          → still alive, keep it mine
 *   POST { action: "finish", id, ok, result, ... } → done, and he gets an email
 *
 * Authenticated by AGENT_RUNNER_KEY, which is NOT the email passphrase: one is
 * a machine credential, the other is a thing he types. Sharing them would mean
 * either leak costs both.
 */
export async function POST(req: NextRequest) {
  const key = await getSecret("AGENT_RUNNER_KEY");
  if (!key) return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  const supplied =
    req.headers.get("x-agent-key") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (supplied !== key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const action = String(body.action ?? "");
  const runner = String(body.runner ?? "mac").slice(0, 60);
  const svc = createServiceClient();

  if (action === "claim") {
    // The switch guards the runner too, not only the inbox. Flipping it off
    // must stop work that is queued but not yet started, or "off" would only
    // mean "off for new mail".
    const { data: sw } = await svc
      .from("site_settings").select("value").eq("key", "agent_email_enabled").maybeSingle();
    if (String((sw as { value?: string } | null)?.value ?? "off").toLowerCase() !== "on") {
      return NextResponse.json({ ok: true, job: null, paused: true });
    }

    // A RUNNER THAT DIED MID-JOB MUST NOT HOLD THE QUEUE. Anything that has
    // been "running" for fifteen minutes without a heartbeat goes back.
    const stale = new Date(Date.now() - 15 * 60_000).toISOString();
    await svc.from("agent_jobs")
      .update({ status: "queued", claimed_at: null, heartbeat_at: null })
      .eq("status", "running").lt("heartbeat_at", stale);

    const { data: next } = await svc.from("agent_jobs")
      .select("id, subject, instruction, from_email")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1).maybeSingle();
    if (!next) return NextResponse.json({ ok: true, job: null });

    // ONE RUNNER, ONE JOB. The update is conditional on the row still being
    // queued, so two runners racing cannot both take it — the loser sees zero
    // rows changed and simply asks again.
    const now = new Date().toISOString();
    const { data: claimed } = await svc.from("agent_jobs")
      .update({ status: "running", claimed_at: now, heartbeat_at: now, runner })
      .eq("id", (next as { id: string }).id).eq("status", "queued")
      .select("id, subject, instruction").maybeSingle();
    if (!claimed) return NextResponse.json({ ok: true, job: null });
    return NextResponse.json({ ok: true, job: claimed });
  }

  if (action === "beat") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "no id" }, { status: 400 });
    await svc.from("agent_jobs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", id).eq("status", "running");
    return NextResponse.json({ ok: true });
  }

  if (action === "finish") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "no id" }, { status: 400 });
    const ok = body.ok === true;
    const result = String(body.result ?? "").slice(0, 60000);
    const error = String(body.error ?? "").slice(0, 8000);
    const exit = Number.isFinite(Number(body.exit_code)) ? Number(body.exit_code) : null;

    const { data: job } = await svc.from("agent_jobs")
      .update({
        status: ok ? "done" : "failed",
        finished_at: new Date().toISOString(),
        result: result || null,
        error: error || null,
        exit_code: exit,
      })
      .eq("id", id)
      .select("from_email, subject, created_at").maybeSingle();

    // He hears back on the same thread he wrote on. A job that finished and
    // told nobody is a job he has to go and look for.
    const to = (job as { from_email?: string } | null)?.from_email;
    if (to) {
      try {
        const { sendEmail, emailShell } = await import("@/lib/notify");
        const subject = String((job as { subject?: string }).subject ?? "");
        const started = (job as { created_at?: string }).created_at;
        const mins = started ? Math.round((Date.now() - new Date(started).getTime()) / 60000) : null;
        const asHtml = (result || error || "(nothing was returned)")
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`)
          .join("");
        await sendEmail(
          to,
          `${ok ? "Done" : "Failed"} — ${subject.replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, "").slice(0, 120) || "your instruction"}`,
          emailShell(ok ? "Done" : "It did not finish", asHtml +
            `<p class="muted">Job ${id.slice(0, 8)}${mins !== null ? ` · ${mins} min` : ""}${exit !== null ? ` · exit ${exit}` : ""}</p>`),
        );
      } catch { /* the job is finished either way; the record holds the answer */ }
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
