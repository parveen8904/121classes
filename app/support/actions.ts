"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  computeEscalateAt, logTicketEvent, notifyStaffNewTicket, TICKET_CATEGORIES,
} from "@/lib/tickets";

function s(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

// Public: a student (logged in or out) raises a support ticket from the website.
// Runs on the service-role client so the deny-all RLS on tickets is bypassed
// server-side only — the form never exposes any ticket data back to the browser.
export async function createSupportTicket(formData: FormData) {
  const title = s(formData.get("title"));
  if (!title) redirect("/support?err=1");

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let name = s(formData.get("student_name"));
  let email = s(formData.get("student_email")).toLowerCase();
  if (user) {
    const { data: p } = await supabase.from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle();
    name = name || (p?.full_name as string) || "";
    email = email || (p?.email as string) || user.email || "";
  }

  const category = s(formData.get("category"));
  const svc = createServiceClient();
  const { data: t } = await svc.from("tickets").insert({
    title,
    description: s(formData.get("description")) || null,
    student_name: name || null,
    student_email: email || null,
    student_phone: s(formData.get("student_phone")) || null,
    user_id: user?.id ?? null,
    source: "website",
    category: (TICKET_CATEGORIES as readonly string[]).includes(category) ? category : null,
    priority: "normal",
    status: "open",
    escalate_at: computeEscalateAt("normal"),
  }).select("id, ref").maybeSingle();

  if (t) {
    await logTicketEvent(svc, t.id, { kind: "created", body: "Raised from the website" });
    // Confirmation to the student + heads-up to staff (both best-effort).
    if (email) {
      const { sendEmail, emailShell } = await import("@/lib/notify");
      await sendEmail(email, `We've got your request (${t.ref}) — CA Parveen Sharma`,
        emailShell("Thanks — we're on it 💚",
          `<p>Hi ${name || "there"}, we've logged your request as <strong>${t.ref}</strong> and our team will get back to you shortly, usually with a call.</p>
           <p><strong>Your message:</strong><br>${title}</p>`)).catch(() => false);
    }
    await notifyStaffNewTicket(svc, { ref: t.ref, title, description: s(formData.get("description")), student_name: name, source: "website" }).catch(() => {});
    redirect(`/support?ok=${encodeURIComponent(t.ref)}`);
  }
  redirect("/support?err=1");
}
