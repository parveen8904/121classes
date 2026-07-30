import { createServiceClient } from "@/lib/supabase/service";
import { sendTemplate } from "@/lib/emailTemplates";

// Complimentary access for past students, at any scale.
//
// The admin pastes the whole list at once; rows land in grant_queue and a
// cron works through them a SMALL batch every ten minutes. The slow drip is
// the point: hundreds of near-identical emails leaving in one burst is
// exactly what spam filters punish, and a punished domain hurts every other
// email the site sends. ~25 per pass ≈ 150 an hour ≈ 3,000+ a day.
//
// Each row does what a hand-grant does: find or create the account, grant,
// shelve, and send HIS letter (the access_granted template) — with a
// set-password button for people who have never logged in, marked important,
// from "CA Parveen Sharma".

const SITE = "https://caparveensharma.com";

export type QueueSummary = { added: number; alreadyQueued: number; badLines: number };

export async function queueGrants(
  lines: string[],
  courseId: string,
  subjectId: string | null,
  tier: string,
  months: number,
): Promise<QueueSummary> {
  const svc = createServiceClient();
  const out: QueueSummary = { added: 0, alreadyQueued: 0, badLines: 0 };

  const rows: { email: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const m = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (!m) { if (line.trim()) out.badLines++; continue; }
    const email = m[0].toLowerCase();
    if (seen.has(email)) continue; // duplicate within the paste
    seen.add(email);
    const name = line.replace(m[0], "").replace(/[,;<>\t"]/g, " ").replace(/\s+/g, " ").trim();
    rows.push({ email, name });
  }

  // Insert in chunks; the (email, course_id) unique key silently keeps
  // anything queued earlier from being queued twice.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      email: r.email, name: r.name || null,
      course_id: courseId, subject_id: subjectId, tier, months,
    }));
    const { data, error } = await svc
      .from("grant_queue")
      .upsert(chunk, { onConflict: "email,course_id", ignoreDuplicates: true })
      .select("id");
    if (error) { out.badLines += chunk.length; continue; }
    out.added += data?.length ?? 0;
    out.alreadyQueued += chunk.length - (data?.length ?? 0);
  }
  return out;
}

function endsAtFromNow(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function expiryLabel(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/** One drip pass. Called from the 10-minute cron; safe to call anytime. */
export async function processGrantQueue(limit = 25, budgetMs = 120_000): Promise<{ sent: number; skipped: number; failed: number; remaining: number }> {
  const svc = createServiceClient();
  const deadline = Date.now() + budgetMs;
  const out = { sent: 0, skipped: 0, failed: 0, remaining: 0 };

  const { data: batch } = await svc
    .from("grant_queue")
    .select("id, email, name, course_id, subject_id, tier, months")
    .eq("status", "pending")
    .order("created_at")
    .limit(limit);
  if (!batch?.length) return out;

  // Course titles and plan ids once per pass, not once per student.
  const planCache = new Map<string, string | null>();
  const planFor = async (tier: string) => {
    if (!planCache.has(tier)) {
      const { data } = await svc.from("plans").select("id").eq("tier", tier).eq("is_active", true).order("rank").limit(1).maybeSingle();
      planCache.set(tier, (data?.id as string) ?? null);
    }
    return planCache.get(tier) ?? null;
  };
  const titleCache = new Map<string, string>();
  const titleFor = async (courseId: string, subjectId: string | null) => {
    const key = `${courseId}:${subjectId ?? ""}`;
    if (!titleCache.has(key)) {
      const { data: c } = await svc.from("courses").select("title").eq("id", courseId).maybeSingle();
      let t = (c?.title as string) ?? "your course";
      if (subjectId) {
        const { data: s } = await svc.from("subjects").select("title").eq("id", subjectId).maybeSingle();
        if (s?.title) t = `${t} — ${s.title}`;
      }
      titleCache.set(key, t);
    }
    return titleCache.get(key)!;
  };

  const finish = (id: string, status: string, detail: string | null, studentId?: string) =>
    svc.from("grant_queue").update({ status, detail, student_id: studentId ?? null, sent_at: new Date().toISOString() }).eq("id", id);

  for (const row of batch) {
    if (Date.now() > deadline) break;
    try {
      const email = String(row.email).toLowerCase();

      // Find or create the account (past students mostly have none here).
      let studentId: string | null = null;
      let created = false;
      const { data: prof } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
      if (prof?.id) studentId = prof.id as string;
      else {
        const { data: cu, error } = await svc.auth.admin.createUser({
          email, email_confirm: true, user_metadata: { full_name: row.name ?? "" },
        });
        if (error || !cu?.user) {
          const retry = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
          studentId = (retry.data?.id as string) ?? null;
        } else {
          studentId = cu.user.id;
          created = true;
          if (row.name) await svc.from("profiles").update({ full_name: row.name }).eq("id", studentId);
        }
      }
      if (!studentId) { await finish(row.id as string, "failed", "could not create the account"); out.failed++; continue; }

      // Already holding active access to this course → no grant, no email.
      const { data: existing } = await svc
        .from("subscriptions").select("id").eq("student_id", studentId)
        .eq("course_id", row.course_id).eq("status", "active").limit(1);
      if (existing?.length) { await finish(row.id as string, "skipped", "already has active access", studentId); out.skipped++; continue; }

      const planId = await planFor(String(row.tier));
      if (!planId) { await finish(row.id as string, "failed", `no active plan for tier "${row.tier}"`); out.failed++; continue; }

      const { error: subErr } = await svc.from("subscriptions").insert({
        student_id: studentId, course_id: row.course_id, subject_id: row.subject_id,
        plan_id: planId, channel: "admin_grant", ends_at: endsAtFromNow(Number(row.months) || 3),
        status: "active", auto_renew: false,
      });
      if (subErr) { await finish(row.id as string, "failed", subErr.message); out.failed++; continue; }

      // Shelf (inline; small numbers per pass).
      let subjectIds: string[] = row.subject_id ? [String(row.subject_id)] : [];
      if (!row.subject_id) {
        const { data: subs } = await svc.from("subjects").select("id").eq("course_id", row.course_id);
        subjectIds = (subs ?? []).map((s) => s.id as string);
      }
      await svc.from("my_courses").upsert({ student_id: studentId, course_id: row.course_id }, { onConflict: "student_id,course_id", ignoreDuplicates: true }).select("student_id");
      for (const sid of subjectIds) {
        await svc.from("my_subjects").upsert({ student_id: studentId, subject_id: sid }, { onConflict: "student_id,subject_id", ignoreDuplicates: true }).select("student_id");
      }

      // His letter — set-password button only for a brand-new account.
      let actionUrl: string | undefined;
      if (created) {
        const { data: link } = await svc.auth.admin.generateLink({ type: "recovery", email });
        const th = link?.properties?.hashed_token;
        if (th) actionUrl = `${SITE}/auth/confirm?token_hash=${th}&type=recovery&next=/auth/set-password`;
      }
      const ok = await sendTemplate("access_granted", email, {
        name: row.name || "there",
        course: await titleFor(String(row.course_id), (row.subject_id as string | null) ?? null),
        tier: String(row.tier), months: Number(row.months) || 3,
        expires: expiryLabel(Number(row.months) || 3),
        action_url: actionUrl, action_label: "Set my password & log in",
      }, undefined, { important: true, bulk: true });

      await finish(row.id as string, ok ? "sent" : "failed", ok ? (created ? "new account created" : "existing account") : "email did not send", studentId);
      if (ok) out.sent++; else out.failed++;
    } catch (e) {
      await finish(row.id as string, "failed", e instanceof Error ? e.message.slice(0, 160) : "unexpected error");
      out.failed++;
    }
  }

  const { count } = await svc.from("grant_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
  out.remaining = count ?? 0;
  return out;
}
