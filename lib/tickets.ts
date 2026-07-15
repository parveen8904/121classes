import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---- Ticket vocabulary -------------------------------------------------------
export const TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_SOURCES = ["website", "phone", "email", "telegram", "other"] as const;
export const TICKET_CATEGORIES = ["payment", "access", "content", "technical", "other"] as const;

export const STATUS_LABEL: Record<string, string> = {
  open: "🔵 Open", in_progress: "🟡 In progress", waiting: "⏳ Waiting on student",
  resolved: "✅ Resolved", closed: "⚫ Closed",
};
export const PRIORITY_LABEL: Record<string, string> = {
  low: "Low", normal: "Normal", high: "High", urgent: "🔴 Urgent",
};
export const OPEN_STATUSES = ["open", "in_progress", "waiting"];

// SLA: hours before an unresolved ticket auto-escalates, by priority.
const SLA_HOURS: Record<string, number> = { urgent: 4, high: 12, normal: 48, low: 96 };

export function computeEscalateAt(priority: string, from: Date = new Date()): string {
  const hours = SLA_HOURS[priority] ?? SLA_HOURS.normal;
  return new Date(from.getTime() + hours * 3600 * 1000).toISOString();
}

// The list of staff a ticket can be assigned to (admins + operators + faculty).
export async function staffList(svc: SupabaseClient): Promise<{ id: string; name: string; email: string | null }[]> {
  const { data } = await svc
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", ["admin", "operator", "faculty"])
    .order("full_name");
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string) || (p.email as string) || "Staff",
    email: (p.email as string | null) ?? null,
  }));
}

// Record one activity-log entry against a ticket (and bump updated_at).
export async function logTicketEvent(
  svc: SupabaseClient,
  ticketId: string,
  ev: { author_id?: string | null; author_name?: string | null; kind: string; body?: string | null },
) {
  await svc.from("ticket_events").insert({ ticket_id: ticketId, ...ev });
  await svc.from("tickets").update({ updated_at: new Date().toISOString() }).eq("id", ticketId);
}

// ---- Notifications -----------------------------------------------------------
export async function notifyStaffNewTicket(svc: SupabaseClient, t: { ref: string; title: string; description?: string | null; student_name?: string | null; source: string }) {
  const { sendEmail, emailShell } = await import("@/lib/notify");
  const staff = await staffList(svc);
  const admins = staff.filter((s) => s.email);
  const html = emailShell(`🎫 New ticket ${t.ref}`,
    `<p>A new ${t.source} ticket has been raised.</p>
     <p><strong>${t.title}</strong></p>
     ${t.description ? `<p>${escapeHtml(t.description).slice(0, 600)}</p>` : ""}
     ${t.student_name ? `<p>From: ${escapeHtml(t.student_name)}</p>` : ""}
     <p><a href="https://caparveensharma.com/admin/tickets">Open the tickets desk →</a></p>`);
  // Email the admins only (operators see it on the desk); best-effort.
  await Promise.all(admins.filter((_, i) => i < 5).map((a) => sendEmail(a.email!, `🎫 New ticket ${t.ref} — ${t.title}`, html).catch(() => false)));
}

export async function notifyAssignee(assigneeEmail: string, t: { ref: string; title: string; student_phone?: string | null; student_name?: string | null }) {
  const { sendEmail, emailShell } = await import("@/lib/notify");
  await sendEmail(assigneeEmail, `📞 Ticket ${t.ref} assigned to you`,
    emailShell(`Ticket ${t.ref} is yours`,
      `<p>You've been assigned <strong>${escapeHtml(t.title)}</strong>.</p>
       ${t.student_name ? `<p>Student: ${escapeHtml(t.student_name)}</p>` : ""}
       ${t.student_phone ? `<p>📞 Please call: <strong>${escapeHtml(t.student_phone)}</strong></p>` : ""}
       <p><a href="https://caparveensharma.com/admin/tickets">Open the tickets desk →</a></p>`)).catch(() => false);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
