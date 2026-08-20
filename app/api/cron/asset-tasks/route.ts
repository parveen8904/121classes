import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { generateOccurrences, dmy, inr, istToday } from "@/lib/assets";
import { sendEmail, emailShell } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// NIGHTLY (03:00 IST, inside the off-peak cron window): the asset register's
// heartbeat. Three jobs, in order:
//
//   1. Materialise upcoming occurrences from the standing tasks.
//   2. Email each assignee their work — once on the due date, and again every
//      third day while it sits overdue. Email, because that is the channel the
//      founder chose for this desk.
//   3. Warn 60 days before a rent agreement lapses.
//
// Nothing here touches money; it only reminds the people who do.

async function staffEmail(svc: ReturnType<typeof createServiceClient>, id: string): Promise<{ email: string; name: string } | null> {
  const { data } = await svc.from("profiles").select("email, full_name").eq("id", id).maybeSingle();
  return data?.email ? { email: String(data.email), name: String(data.full_name ?? "") } : null;
}

async function logNote(svc: ReturnType<typeof createServiceClient>, template: string, to: string, ok: boolean) {
  await svc.from("notifications").insert({
    student_id: null, channel: "email", template,
    payload: { to }, status: ok ? "sent" : "failed", sent_at: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const today = istToday();
  const made = await generateOccurrences();
  let reminded = 0, warned = 0;

  // ── Due today + overdue, grouped per assignee: one email each, not ten ──
  const { data: pend } = await svc
    .from("asset_occurrences")
    .select("id, due_on, reminded_at, overdue_reminded_at, asset_tasks!inner(title, expected_amount, assigned_to), assets!inner(name, status)")
    .eq("status", "pending").lte("due_on", today).limit(300);

  const threeDaysAgo = Date.now() - 3 * 86400_000;
  type Row = NonNullable<typeof pend>[number];
  const byAssignee = new Map<string, Row[]>();
  for (const o of pend ?? []) {
    if ((o.assets as unknown as { status?: string }).status === "closed") continue;
    const who = (o.asset_tasks as unknown as { assigned_to: string | null }).assigned_to;
    if (!who) continue; // unassigned work shows on the pendency screen instead
    const dueToday = String(o.due_on) === today && !o.reminded_at;
    const overdueAgain = String(o.due_on) < today &&
      (!o.overdue_reminded_at || new Date(String(o.overdue_reminded_at)).getTime() < threeDaysAgo);
    if (!dueToday && !overdueAgain) continue;
    byAssignee.set(who, [...(byAssignee.get(who) ?? []), o]);
  }

  for (const [who, rows] of byAssignee) {
    const person = await staffEmail(svc, who);
    if (!person) continue;
    const items = rows.map((o) => {
      const t = o.asset_tasks as unknown as { title: string; expected_amount: number | null };
      const late = String(o.due_on) < today;
      return `<li>${late ? "<strong>OVERDUE</strong> — " : ""}${t.title} · ${(o.assets as unknown as { name: string }).name} · due ${dmy(String(o.due_on))}${t.expected_amount != null ? ` · expected ${inr(t.expected_amount)}` : ""}</li>`;
    }).join("");
    const html = emailShell(
      "Your asset work",
      `<p>Dear ${person.name.split(" ")[0] || "there"},</p>
       <p>These asset tasks are due or overdue today:</p><ul>${items}</ul>
       <p>Record each on caparveensharma.com/admin/assets/work — the completion form takes the amount, GST/TDS and the proof in one go.</p>`,
    );
    const ok = await sendEmail(person.email, `Asset work — ${rows.length} item${rows.length > 1 ? "s" : ""} due`, html).catch(() => false);
    await logNote(svc, "asset_task_due", person.email, ok);
    if (ok) {
      reminded += rows.length;
      const now = new Date().toISOString();
      for (const o of rows) {
        await svc.from("asset_occurrences").update(
          String(o.due_on) === today ? { reminded_at: now } : { overdue_reminded_at: now },
        ).eq("id", o.id);
      }
    }
  }

  // ── Agreement expiry: warn once, 60 days out ────────────────────────────
  const in60 = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  const { data: expiring } = await svc
    .from("asset_tenancy")
    .select("asset_id, tenant_name, agreement_expiry, assets!inner(name, status)")
    .is("expiry_warned_at", null)
    .not("agreement_expiry", "is", null)
    .lte("agreement_expiry", in60);

  for (const e of expiring ?? []) {
    if ((e.assets as unknown as { status?: string }).status === "closed") continue;
    // Tell the rent task's assignee if there is one; the pendency screen
    // carries it either way.
    const { data: task } = await svc.from("asset_tasks")
      .select("assigned_to").eq("asset_id", e.asset_id).eq("from_tenancy", true).maybeSingle();
    let ok = false;
    if (task?.assigned_to) {
      const person = await staffEmail(svc, String(task.assigned_to));
      if (person) {
        ok = await sendEmail(
          person.email,
          `Rent agreement expiring — ${(e.assets as unknown as { name: string }).name}`,
          emailShell("Agreement expiring", `<p>The agreement with ${String(e.tenant_name ?? "the tenant")} for <strong>${(e.assets as unknown as { name: string }).name}</strong> expires on <strong>${dmy(String(e.agreement_expiry))}</strong>. Start the renewal conversation now.</p>`),
        ).catch(() => false);
        await logNote(svc, "asset_agreement_expiry", person.email, ok);
      }
    }
    await svc.from("asset_tenancy").update({ expiry_warned_at: new Date().toISOString() }).eq("asset_id", e.asset_id);
    warned++;
  }

  return NextResponse.json({ ok: true, occurrencesMade: made, reminded, expiryWarned: warned });
}
