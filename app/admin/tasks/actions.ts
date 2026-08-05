"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str, nullable } from "../_lib/util";

// Office tasks. Every action here writes an EVENT as well as changing the task,
// because the history is the point: a job that has been forwarded twice is
// useless if nobody can see who sent it on and why.

async function me(): Promise<{ id: string; name: string; role: string } | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!data || !["admin", "faculty", "operator"].includes(String(data.role))) return null;
  return { id: String(data.id), name: String(data.full_name || data.email || "Someone"), role: String(data.role) };
}

async function event(taskId: string, actorId: string, kind: string, body?: string | null, toUserId?: string | null) {
  await createServiceClient().from("staff_task_events").insert({
    task_id: taskId,
    actor_id: actorId,
    kind,
    body: body ?? null,
    to_user_id: toUserId ?? null,
  });
}

/** Tell the person it is now with — they should not have to keep the page open. */
async function tell(userId: string | null, subject: string, line: string) {
  if (!userId) return;
  try {
    const svc = createServiceClient();
    const { data: p } = await svc.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
    if (!p?.email) return;
    const { sendEmail, emailShell } = await import("@/lib/notify");
    await sendEmail(
      String(p.email),
      subject,
      emailShell(subject, `<p>${line}</p><p><a href="https://caparveensharma.com/admin/tasks">Open your task list</a></p>`),
    );
  } catch { /* a task must not fail because mail did */ }
}

/** Post one task, or several at once — one per line, as the founder asked. */
export async function createTasks(formData: FormData) {
  const who = await me();
  if (!who) return;

  const assignee = nullable(formData.get("assignee_id"));
  const detail = str(formData.get("detail"));
  const priority = ["low", "normal", "high"].includes(str(formData.get("priority"))) ? str(formData.get("priority")) : "normal";
  const due = nullable(formData.get("due_on"));

  // "Any number of items" — one per line, so a list of eight jobs is one paste.
  const lines = str(formData.get("titles")).split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) redirect("/admin/tasks?err=Write at least one task");

  const svc = createServiceClient();
  const { data: made } = await svc
    .from("staff_tasks")
    .insert(
      lines.map((title) => ({
        title: title.slice(0, 300),
        detail: lines.length === 1 ? detail || null : detail || null,
        assignee_id: assignee,
        created_by: who.id,
        priority,
        due_on: due,
      })),
    )
    .select("id");

  for (const t of made ?? []) await event(String(t.id), who.id, "created");
  await tell(
    assignee,
    lines.length === 1 ? `New task: ${lines[0].slice(0, 60)}` : `${lines.length} new tasks for you`,
    `${who.name} has assigned you ${lines.length === 1 ? "a task" : `${lines.length} tasks`}.`,
  );

  revalidatePath("/admin/tasks");
  redirect(`/admin/tasks?made=${made?.length ?? 0}`);
}

/** Move it along: start it, finish it, or put it back. */
export async function setTaskStatus(formData: FormData) {
  const who = await me();
  if (!who) return;
  const id = str(formData.get("id"));
  const status = str(formData.get("status"));
  if (!id || !["open", "doing", "done", "cancelled"].includes(status)) return;

  const svc = createServiceClient();
  await svc
    .from("staff_tasks")
    .update({
      status,
      done_at: status === "done" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  await event(id, who.id, "status", status);

  // Tell whoever asked for it that it is finished — that is the moment they
  // are waiting for, and chasing it is the thing this replaces.
  if (status === "done") {
    const { data: t } = await svc.from("staff_tasks").select("title, created_by").eq("id", id).maybeSingle();
    if (t?.created_by && t.created_by !== who.id) {
      await tell(String(t.created_by), `Done: ${String(t.title).slice(0, 60)}`, `${who.name} has completed it.`);
    }
  }

  revalidatePath("/admin/tasks");
  redirect("/admin/tasks");
}

/** A note on the task — the "put some remarks" the founder asked for. */
export async function addRemark(formData: FormData) {
  const who = await me();
  if (!who) return;
  const id = str(formData.get("id"));
  const body = str(formData.get("body"));
  if (!id || !body) return;

  await event(id, who.id, "remark", body.slice(0, 4000));
  await createServiceClient().from("staff_tasks").update({ updated_at: new Date().toISOString() }).eq("id", id);

  // Everyone who has held this task hears about it, except whoever just spoke.
  const svc = createServiceClient();
  const { data: t } = await svc.from("staff_tasks").select("title, assignee_id, created_by").eq("id", id).maybeSingle();
  for (const uid of [t?.assignee_id, t?.created_by]) {
    if (uid && String(uid) !== who.id) {
      await tell(String(uid), `Note on: ${String(t?.title ?? "a task").slice(0, 60)}`, `${who.name} wrote: ${body.slice(0, 300)}`);
    }
  }

  revalidatePath("/admin/tasks");
  redirect("/admin/tasks");
}

/** Hand it to somebody else, with a reason. */
export async function forwardTask(formData: FormData) {
  const who = await me();
  if (!who) return;
  const id = str(formData.get("id"));
  const to = nullable(formData.get("to_user_id"));
  const why = str(formData.get("why"));
  if (!id || !to) return;

  const svc = createServiceClient();
  await svc
    .from("staff_tasks")
    .update({ assignee_id: to, status: "open", updated_at: new Date().toISOString() })
    .eq("id", id);
  await event(id, who.id, "forwarded", why.slice(0, 1000) || null, to);

  const { data: t } = await svc.from("staff_tasks").select("title").eq("id", id).maybeSingle();
  await tell(
    to,
    `Passed to you: ${String(t?.title ?? "a task").slice(0, 60)}`,
    `${who.name} has forwarded this to you.${why ? ` They said: ${why.slice(0, 300)}` : ""}`,
  );

  revalidatePath("/admin/tasks");
  redirect("/admin/tasks");
}
