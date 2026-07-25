"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { notifyByEmail, emailShell } from "@/lib/notify";
import { str } from "../_lib/util";

// Approve = send THIS draft now (with any edits made in the form) and mark sent.
export async function approveAndSend(formData: FormData) {
  if (!(await requireArea("reengage"))) return;
  const id = str(formData.get("id"));
  const subject = str(formData.get("subject")).trim();
  const body = str(formData.get("body")).trim();
  if (!id || !subject || !body) return;

  const svc = createServiceClient();
  const { data: draft } = await svc
    .from("reengage_drafts")
    .select("id, student_id, email, status")
    .eq("id", id)
    .maybeSingle();
  if (!draft || draft.status !== "draft") return;

  const html = emailShell(subject, `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`);
  await notifyByEmail({
    studentId: draft.student_id as string,
    email: draft.email as string,
    subject,
    html,
    template: "reengage",
    payload: { draftId: id },
  });
  await svc.from("reengage_drafts")
    .update({ status: "sent", subject, body, sent_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/reengage");
}

export async function rejectDraft(formData: FormData) {
  if (!(await requireArea("reengage"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("reengage_drafts").update({ status: "rejected" }).eq("id", id).eq("status", "draft");
  revalidatePath("/admin/reengage");
}
