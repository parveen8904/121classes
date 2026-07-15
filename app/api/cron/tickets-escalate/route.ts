import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendEmail, emailShell } from "@/lib/notify";
import { logTicketEvent, staffList, OPEN_STATUSES } from "@/lib/tickets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Auto-escalate tickets that blew past their SLA window (escalate_at) without
// being resolved. Marks them escalated, logs it, and emails the admins once.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const nowIso = new Date().toISOString();
  const { data: due } = await svc
    .from("tickets")
    .select("id, ref, title, assigned_to")
    .eq("escalated", false)
    .in("status", OPEN_STATUSES)
    .lte("escalate_at", nowIso)
    .limit(50);

  const tickets = due ?? [];
  if (tickets.length === 0) return NextResponse.json({ escalated: 0 });

  const admins = (await staffList(svc)).filter((s) => s.email).slice(0, 5);

  for (const t of tickets) {
    await svc.from("tickets").update({ escalated: true, updated_at: nowIso }).eq("id", t.id);
    await logTicketEvent(svc, t.id as string, { author_name: "System", kind: "escalate", body: "Auto-escalated — SLA time exceeded without resolution" });
  }

  // One digest email to admins rather than one per ticket.
  if (admins.length) {
    const list = tickets.map((t) => `<li>${t.ref} — ${t.title}</li>`).join("");
    const html = emailShell("⚠️ Tickets need attention",
      `<p>${tickets.length} ticket(s) passed their response time without being resolved:</p><ul>${list}</ul>
       <p><a href="https://caparveensharma.com/admin/tickets">Open the tickets desk →</a></p>`);
    await Promise.all(admins.map((a) => sendEmail(a.email!, `⚠️ ${tickets.length} ticket(s) escalated`, html).catch(() => false)));
  }

  return NextResponse.json({ escalated: tickets.length });
}
