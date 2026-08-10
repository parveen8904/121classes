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

// REPLYING TO THE STUDENT — WHICH THIS SCREEN COULD NOT DO.
//
// A ticket could be assigned, noted, escalated, prioritised and closed. Every
// one of those notifies a member of staff. Not one of them said anything to the
// person who raised it. Notes are internal, so a ticket worked on diligently
// still looked, from the student's side, exactly like a ticket nobody had read
// — and that is why they were being raised twice and then escalated.
//
// A reply here goes to the student by email, is written into the ticket's own
// history so the next person can see what was already said, and moves the
// ticket on. Answering IS the work; it should not have been the one thing the
// screen left out.
export async function replyToStudent(formData: FormData) {
  if (!(await requireArea("tickets"))) return;
  const id = str(formData.get("id"));
  const body = str(formData.get("body"));
  if (!id || !body) return;

  const svc = createServiceClient();
  const me = await actor();
  const { data: t } = await svc
    .from("tickets")
    .select("ref, title, student_name, student_email, user_id, status")
    .eq("id", id).maybeSingle();
  if (!t) return;

  // The address on the ticket, or the one on their account if it was raised
  // from inside the portal without one.
  let email = String((t as { student_email?: string | null }).student_email ?? "").trim();
  if (!email && (t as { user_id?: string | null }).user_id) {
    const { data: p } = await svc.from("profiles").select("email")
      .eq("id", (t as { user_id: string }).user_id).maybeSingle();
    email = String(p?.email ?? "").trim();
  }

  let delivered = false;
  if (email) {
    const { sendEmail, emailShell } = await import("@/lib/notify");
    const name = String((t as { student_name?: string | null }).student_name ?? "").split(" ")[0];
    const html = emailShell(
      `About your query — ${(t as { ref: string }).ref}`,
      `<p>${name ? `Dear ${name},` : "Hello,"}</p>
       <p>You wrote to us about <strong>${(t as { title: string }).title}</strong>. Here is where it stands:</p>
       <div style="border-left:3px solid #eab308;padding:2px 0 2px 14px;margin:14px 0;line-height:1.7">
         ${body.split("\n").filter(Boolean).map((l) => `<p style="margin:0 0 10px">${l}</p>`).join("")}
       </div>
       <p>If this does not answer it, simply reply to this email — it comes back to the same ticket and we will pick it up.</p>`,
    );
    delivered = await sendEmail(email, `${(t as { ref: string }).ref} — ${(t as { title: string }).title}`, html).catch(() => false);
  }

  await logTicketEvent(svc, id, {
    author_id: me.id, author_name: me.name, kind: "note",
    // Marked as sent or not sent, plainly. A reply logged as though it went out
    // when the email bounced is worse than no log at all — the next person
    // reads it and assumes the student has been told.
    body: delivered ? `💬 Replied to ${email}:\n\n${body}` : `⚠️ Reply NOT sent (no working email on this ticket):\n\n${body}`,
  });

  // Answered, not closed. The student may still come back on it, and closing a
  // ticket the moment we speak is how a half-answer becomes a lost one.
  if (delivered && OPEN_STATUSES.includes(String((t as { status: string }).status))) {
    await svc.from("tickets").update({ status: "waiting", updated_at: new Date().toISOString() }).eq("id", id);
  }
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/admin/tickets");
}
