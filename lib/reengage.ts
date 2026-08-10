import { createServiceClient } from "@/lib/supabase/service";
import { selectAll, inChunks } from "@/lib/pageAll";
import { sendEmail, emailShell, emailConfigured } from "@/lib/notify";

// TWO EMAILS, THEN WE LEAVE THEM ALONE.
//
// This used to write drafts for a person to approve. Two hundred and ninety-four
// of them are still sitting there unapproved, which means two hundred and
// ninety-four students who signed up and heard nothing at all. Approval was the
// bottleneck, and the bottleneck won.
//
// So it sends, on a ladder the founder set:
//
//   Day 3 — signed up, never opened a class. One note, warm, no selling.
//   Day 7 — still nothing. One last note, and it SAYS it is the last one.
//   After that — silence. Somebody who ignored two emails is not persuaded by
//   a third; they are annoyed by it, and they mark it spam, which costs us
//   every other student's inbox.
//
// Anyone who has watched even one class drops out of the ladder immediately.
// They came back; that is the whole point.
//
// And anyone who has never signed in is not on the ladder at all. They did not
// forget to start; they were never able to. That is a different problem with a
// different answer, and it has its own cron.

const CAP_PER_RUN = 300;

export type ReengageResult = {
  ok: true;
  day3: number;
  day7: number;
  skipped: string;
};

const firstName = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || "there";

function day3Email(name: string): { subject: string; html: string } {
  return {
    subject: "Your first class is waiting",
    html:
      `<p>Hi ${name},</p>` +
      `<p>You created your account a few days ago but have not opened a class yet. Nothing is wrong — I just wanted to make sure you know where to start.</p>` +
      `<p><strong>The first five classes of every subject are free to watch.</strong> No payment, no card. Sign in and open your course from the dashboard.</p>` +
      `<p>Two other things that cost nothing:</p>` +
      `<ul>` +
      `<li>A day-by-day study plan built around your exam date — <a href="https://caparveensharma.com/build-your-plan">build-your-plan</a></li>` +
      `<li>Revision Test Papers, Mock Test Papers and past exam papers — <a href="https://caparveensharma.com/notes">caparveensharma.com/notes</a></li>` +
      `</ul>` +
      `<p><a href="https://caparveensharma.com/dashboard" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open my dashboard</a></p>` +
      `<p>If something is not working, or you are not sure where to begin, just reply to this email. A person reads it.</p>`,
  };
}

function day7Email(name: string): { subject: string; html: string } {
  return {
    subject: "Last note from us",
    html:
      `<p>Hi ${name},</p>` +
      `<p>I wrote a few days ago about getting started, and I have not heard back. This is the last email you will get from me about it — I would rather leave you alone than keep filling your inbox.</p>` +
      `<p>If the timing is wrong, that is completely fine. Everything stays where it is, and your account does not expire.</p>` +
      `<p>If something stopped you — the site not working, not knowing where to start, or the fees — reply to this email and tell me which. I will sort it out or tell you honestly if we cannot.</p>` +
      `<p>Either way, good luck with your exam. I mean that.</p>` +
      `<p><a href="https://caparveensharma.com/dashboard">caparveensharma.com</a></p>`,
  };
}

/**
 * Run the ladder once.
 *
 * Used by the nightly cron and by the button in Admin → Re-engagement, so
 * pressing the button does exactly what the night does — not a second copy that
 * drifts out of step.
 */
export async function runReengagement(): Promise<ReengageResult> {
  if (!(await emailConfigured())) return { ok: true, day3: 0, day7: 0, skipped: "email not configured" };

  const svc = createServiceClient();
  const now = Date.now();
  const d3 = new Date(now - 3 * 86400_000).toISOString();
  const d7 = new Date(now - 7 * 86400_000).toISOString();

  // Paged: there are thousands of students, and unpaged this took the first
  // thousand — so the same slice was reconsidered every night and everybody
  // else was never contacted at all.
  const profs = await selectAll<{
    id: string; full_name: string | null; email: string | null;
    created_at: string; role: string; account_type: string | null;
  }>((f, t) =>
    svc.from("profiles")
      .select("id, full_name, email, created_at, role, account_type")
      .eq("role", "student").not("email", "is", null).range(f, t),
  );
  // ONLY PEOPLE WHO HAVE ACTUALLY BEEN INSIDE.
  //
  // "You signed up and never opened a class" is only true of somebody who
  // signed up and got in. Without this it was also true of 1,446 accounts
  // granted in bulk in early August that have never once been opened — people
  // who did not sign up here at all, and whose problem is that no password was
  // ever set on their account. They need a sign-in link (see the locked-out
  // cron), not a note asking why they have not started.
  //
  // Sending to them would be a cold mailshot of 1,700 from a domain that has
  // been quiet, which is how a sender gets marked spam — and this domain also
  // carries every student's password reset.
  const signedIn = new Set<string>(
    ((await svc.rpc("students_signed_in_ids")).data as { id: string }[] | null ?? []).map((r) => r.id),
  );
  const students = profs.filter((p) => p.account_type !== "sponsor" && signedIn.has(p.id));
  if (!students.length) return { ok: true, day3: 0, day7: 0, skipped: "no students who have signed in" };

  // Anyone who has watched ANYTHING is out of the ladder. They started.
  const watched = new Set(
    (await inChunks<{ student_id: string }>(
      students.map((p) => p.id),
      (b) => svc.from("class_watch").select("student_id").in("student_id", b),
    )).map((w) => w.student_id),
  );

  // What each student has already been sent. The ladder must never repeat a
  // rung, and must never go past the second.
  const already = await inChunks<{ student_id: string; kind: string }>(
    students.map((p) => p.id),
    (b) => svc.from("reengage_drafts").select("student_id, kind").in("student_id", b),
  );
  const sent = new Set(already.map((r) => `${r.student_id}:${r.kind}`));

  const due3 = students.filter(
    (p) => p.created_at < d3 && !watched.has(p.id)
      && !sent.has(`${p.id}:never_started_d3`) && !sent.has(`${p.id}:never_started_d7`),
  ).slice(0, CAP_PER_RUN);

  const due7 = students.filter(
    (p) => p.created_at < d7 && !watched.has(p.id)
      && sent.has(`${p.id}:never_started_d3`) && !sent.has(`${p.id}:never_started_d7`),
  ).slice(0, CAP_PER_RUN);

  let day3 = 0;
  let day7 = 0;

  for (const [list, kind, build] of [
    [due3, "never_started_d3", day3Email],
    [due7, "never_started_d7", day7Email],
  ] as const) {
    for (const p of list) {
      const { subject, html } = build(firstName(p.full_name));
      const ok = await sendEmail(p.email as string, subject, emailShell(subject, html)).catch(() => false);

      // Recorded either way. A send that failed must still occupy its rung, or
      // the ladder would retry it every night for ever.
      await svc.from("reengage_drafts").insert({
        student_id: p.id,
        kind,
        email: p.email,
        subject,
        body: html,
        status: ok ? "sent" : "failed",
        sent_at: ok ? new Date().toISOString() : null,
      });
      if (ok) { if (kind === "never_started_d3") day3++; else day7++; }
    }
  }

  return {
    ok: true,
    day3,
    day7,
    skipped: `${students.length} have signed in at least once; ${watched.size} of them opened a class and are left alone`,
  };
}
