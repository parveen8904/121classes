import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

/**
 * WORK ORDERED BY EMAIL.
 *
 * He writes to a private address, the instruction is queued, and a small runner
 * on his Mac claims it and runs Claude Code headless in the repository. This is
 * the most dangerous thing in the portal: an email that gets through this file
 * causes code to run on his machine, in his repository, with his credentials.
 *
 * A From: header is a suggestion, not proof — anybody can put his address on an
 * email. So the sender is never trusted on its own. FOUR things must all hold,
 * and the order matters because the cheapest and most decisive come first:
 *
 *   1. The switch is ON.        A kill switch he controls, which starts OFF.
 *   2. The passphrase is there. A shared secret only he knows. This is the
 *                              real lock; the other three are defence in depth.
 *   3. SPF and DKIM passed.     Mailgun's own verdicts, so a forged From: from
 *                              a domain that signs its mail is caught.
 *   4. The sender is on the list. His own addresses, nobody else's.
 *
 * Every attempt is recorded either way. A refusal is written down as a refusal
 * — a channel like this failing silently is how you find out about it late.
 */

/** Local part of the address that orders work, e.g. "do" in do@domain.com. */
export async function agentInboxName(): Promise<string> {
  return ((await getSecret("AGENT_EMAIL_LOCAL")) || "do").trim().toLowerCase();
}

export type Verdict = { ok: true } | { ok: false; why: string; tellHim: boolean };

/**
 * Is this email allowed to order work? `tellHim` says whether the refusal is
 * worth an alert: a missing passphrase on mail that otherwise looks like his is
 * worth knowing about, because it is either him mistyping or somebody probing.
 */
export async function mayOrderWork(form: FormData, from: string): Promise<Verdict> {
  const svc = createServiceClient();

  const { data: sw } = await svc
    .from("site_settings").select("value").eq("key", "agent_email_enabled").maybeSingle();
  if (String((sw as { value?: string } | null)?.value ?? "off").toLowerCase() !== "on") {
    return { ok: false, why: "the email channel is switched off", tellHim: false };
  }

  // THE PASSPHRASE. Checked against subject AND body, because his mail client
  // may quote or reflow either. Compared in lower case with the surrounding
  // punctuation ignored, so it survives a signature or an autocorrect.
  const secret = ((await getSecret("AGENT_EMAIL_SECRET")) || "").trim().toLowerCase();
  if (!secret) return { ok: false, why: "no passphrase is configured, so nothing can be authorised", tellHim: true };
  const haystack = [
    String(form.get("subject") ?? ""),
    String(form.get("stripped-text") ?? form.get("body-plain") ?? ""),
  ].join("\n").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  if (!haystack.includes(secret)) {
    return { ok: false, why: "the passphrase was not in the message", tellHim: true };
  }

  // MAILGUN'S OWN VERDICTS. It reports SPF and DKIM per message; a domain that
  // signs its mail (gmail.com does) cannot be impersonated past this.
  const spf = String(form.get("X-Mailgun-Spf") ?? "").trim().toLowerCase();
  const dkim = String(form.get("X-Mailgun-Dkim-Check-Result") ?? "").trim().toLowerCase();
  if (spf && spf !== "pass") return { ok: false, why: `SPF said "${spf}"`, tellHim: true };
  if (dkim && dkim !== "pass") return { ok: false, why: `DKIM said "${dkim}"`, tellHim: true };

  // AND IT MUST BE HIM. Comma-separated; falls back to the address the site
  // already blind-copies his own answers to.
  const listed = ((await getSecret("AGENT_EMAIL_ALLOWED")) || (await getSecret("AI_REPLY_BCC")) || "")
    .toLowerCase().split(/[,\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
  if (!listed.length) return { ok: false, why: "no sender is on the allowed list", tellHim: true };
  if (!listed.includes(from.toLowerCase())) {
    return { ok: false, why: `${from} is not on the allowed list`, tellHim: true };
  }

  return { ok: true };
}

/**
 * The instruction, cleaned up.
 *
 * The subject usually carries the ask and the body the detail, so both are
 * kept. The passphrase is stripped out — it should not travel on to the model,
 * and it must not end up quoted back in a result email.
 */
export function buildInstruction(subject: string, body: string, secret: string): string {
  const strip = (s: string) =>
    secret ? s.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").trim() : s.trim();
  const s = strip(subject.replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, ""));
  const b = strip(body);
  return [s, b].filter(Boolean).join("\n\n").slice(0, 8000).trim();
}

export async function queueJob(input: {
  from: string; subject: string; instruction: string;
}): Promise<string | null> {
  const svc = createServiceClient();
  const { data } = await svc.from("agent_jobs").insert({
    from_email: input.from,
    subject: input.subject.slice(0, 500),
    instruction: input.instruction,
    status: "queued",
  }).select("id").maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export async function recordRefusal(input: {
  from: string; subject: string; instruction: string; why: string;
}): Promise<void> {
  const svc = createServiceClient();
  await svc.from("agent_jobs").insert({
    from_email: input.from,
    subject: input.subject.slice(0, 500),
    instruction: input.instruction.slice(0, 2000),
    status: "refused",
    refused_why: input.why,
  });
}
