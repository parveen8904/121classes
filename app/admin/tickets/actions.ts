"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { str } from "../_lib/util";
import {
  computeEscalateAt, logTicketEvent, notifyAssignee,
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES, TICKET_SOURCES, OPEN_STATUSES,
} from "@/lib/tickets";

function pick<T extends readonly string[]>(v: string, allowed: T, fallback: T[number]): T[number] {
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

// The signed-in staff member's id + display name (for the activity log).
async function actor(): Promise<{ id: string | null; name: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { id: null, name: "Staff" };
  const { data } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  return { id: user.id, name: (data?.full_name as string) || (data?.email as string) || "Staff" };
}

// Log a ticket from a phone call or any manual channel.
export async function createTicketAdmin(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const title = str(formData.get("title"));
  if (!title) return;
  const svc = createServiceClient();
  const me = await actor();
  const priority = pick(str(formData.get("priority")), TICKET_PRIORITIES, "normal");
  const assignedTo = str(formData.get("assigned_to")) || null;
  const { data: t } = await svc.from("tickets").insert({
    title,
    description: str(formData.get("description")) || null,
    student_name: str(formData.get("student_name")) || null,
    student_email: str(formData.get("student_email")).trim().toLowerCase() || null,
    student_phone: str(formData.get("student_phone")) || null,
    source: pick(str(formData.get("source")), TICKET_SOURCES, "phone"),
    category: str(formData.get("category")) ? pick(str(formData.get("category")), TICKET_CATEGORIES, "other") : null,
    priority,
    status: assignedTo ? "in_progress" : "open",
    assigned_to: assignedTo,
    escalate_at: computeEscalateAt(priority),
  }).select("id, ref").maybeSingle();

  if (t) {
    await logTicketEvent(svc, t.id, { author_id: me.id, author_name: me.name, kind: "created", body: `Logged from ${str(formData.get("source")) || "phone"}` });
    if (assignedTo) await assignNotify(svc, t.id, assignedTo, me);
  }
  revalidatePath("/admin/tickets");
  if (t) redirect(`/admin/tickets/${t.id}`);
}

async function assignNotify(svc: ReturnType<typeof createServiceClient>, ticketId: string, assigneeId: string, me: { id: string | null; name: string }) {
  const { data: a } = await svc.from("profiles").select("full_name, email").eq("id", assigneeId).maybeSingle();
  const { data: t } = await svc.from("tickets").select("ref, title, student_name, student_phone").eq("id", ticketId).maybeSingle();
  await logTicketEvent(svc, ticketId, { author_id: me.id, author_name: me.name, kind: "assign", body: `Assigned to ${(a?.full_name as string) || "staff"}` });
  if (a?.email && t) await notifyAssignee(a.email as string, t as { ref: string; title: string; student_name?: string | null; student_phone?: string | null });
}

export async function assignTicket(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const id = str(formData.get("id"));
  const assignedTo = str(formData.get("assigned_to")) || null;
  if (!id) return;
  const svc = createServiceClient();
  const me = await actor();
  const { data: cur } = await svc.from("tickets").select("status").eq("id", id).maybeSingle();
  const patch: Record<string, unknown> = { assigned_to: assignedTo, updated_at: new Date().toISOString() };
  if (assignedTo && cur?.status === "open") patch.status = "in_progress";
  await svc.from("tickets").update(patch).eq("id", id);
  if (assignedTo) await assignNotify(svc, id, assignedTo, me);
  else await logTicketEvent(svc, id, { author_id: me.id, author_name: me.name, kind: "assign", body: "Unassigned" });
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/admin/tickets");
}

export async function addTicketNote(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const id = str(formData.get("id"));
  const body = str(formData.get("body"));
  const kind = str(formData.get("kind")) === "call" ? "call" : "note";
  if (!id || !body) return;
  const svc = createServiceClient();
  const me = await actor();
  await logTicketEvent(svc, id, { author_id: me.id, author_name: me.name, kind, body });
  revalidatePath(`/admin/tickets/${id}`);
}

export async function updateTicketStatus(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const id = str(formData.get("id"));
  const status = pick(str(formData.get("status")), TICKET_STATUSES, "open");
  if (!id) return;
  const svc = createServiceClient();
  const me = await actor();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  patch.resolved_at = status === "resolved" ? now : null;
  patch.closed_at = status === "closed" ? now : null;
  // Re-opening clears the escalation flag so the SLA clock can run again.
  if (OPEN_STATUSES.includes(status)) patch.escalated = false;
  await svc.from("tickets").update(patch).eq("id", id);
  await logTicketEvent(svc, id, { author_id: me.id, author_name: me.name, kind: "status", body: `Status → ${status}` });
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/admin/tickets");
}

export async function setTicketFields(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const me = await actor();
  const { data: cur } = await svc.from("tickets").select("priority, status").eq("id", id).maybeSingle();
  const priority = pick(str(formData.get("priority")), TICKET_PRIORITIES, "normal");
  const patch: Record<string, unknown> = {
    title: str(formData.get("title")) || undefined,
    category: str(formData.get("category")) ? pick(str(formData.get("category")), TICKET_CATEGORIES, "other") : null,
    priority,
    student_name: str(formData.get("student_name")) || null,
    student_email: str(formData.get("student_email")).trim().toLowerCase() || null,
    student_phone: str(formData.get("student_phone")) || null,
    updated_at: new Date().toISOString(),
  };
  // If priority changed and the ticket is still open, reset the escalation clock.
  if (cur && cur.priority !== priority && OPEN_STATUSES.includes(cur.status as string)) {
    patch.escalate_at = computeEscalateAt(priority);
    patch.escalated = false;
  }
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  await svc.from("tickets").update(patch).eq("id", id);
  await logTicketEvent(svc, id, { author_id: me.id, author_name: me.name, kind: "note", body: "Details updated" });
  revalidatePath(`/admin/tickets/${id}`);
}

// Manually escalate now (e.g. staff can't resolve it).
export async function escalateTicket(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const me = await actor();
  await svc.from("tickets").update({ escalated: true, priority: "high", updated_at: new Date().toISOString() }).eq("id", id);
  await logTicketEvent(svc, id, { author_id: me.id, author_name: me.name, kind: "escalate", body: str(formData.get("body")) || "Escalated for attention" });
  const { data: t } = await svc.from("tickets").select("ref, title").eq("id", id).maybeSingle();
  if (t) {
    const { staffList } = await import("@/lib/tickets");
    const { sendEmail, emailShell } = await import("@/lib/notify");
    const admins = (await staffList(svc)).filter((s) => s.email).slice(0, 5);
    await Promise.all(admins.map((a) => sendEmail(a.email!, `⚠️ Ticket ${t.ref} escalated`,
      emailShell(`Ticket ${t.ref} escalated`, `<p><strong>${t.title}</strong> needs attention.</p><p><a href="https://caparveensharma.com/admin/tickets/${id}">Open ticket →</a></p>`)).catch(() => false)));
  }
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/admin/tickets");
}

export async function deleteTicket(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("tickets").delete().eq("id", id);
  revalidatePath("/admin/tickets");
  redirect("/admin/tickets");
}
