"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { resolveFileUrl } from "@/lib/storage";

// SEND CHOSEN PROFILES TO AN EMPLOYER.
//
// Resumes go as ATTACHMENTS, not links. A recruiter has no login here, and the
// standing rule is that no email ever carries a raw storage link — so the files
// travel inside the mail, each renamed to the candidate, with a summary table
// in the body.
//
// Only consented profiles can be sent; the page never offers the others. The
// send is recorded in notifications so "which firms got whose CV" has an
// answer.
export async function sendCvsToEmployer(formData: FormData) {
  if (!(await requireArea("students"))) return;
  const to = String(formData.get("to") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);
  const ids = formData.getAll("student_ids").map(String).filter(Boolean).slice(0, 10);
  if (!to || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) {
    redirect(`/admin/cvs?err=${encodeURIComponent("Enter the employer's email address.")}`);
  }
  if (!ids.length) redirect(`/admin/cvs?err=${encodeURIComponent("Tick at least one student.")}`);

  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("career_profiles").select("*")
    .in("student_id", ids)
    .eq("share_consent", true);   // the tick is the licence; unticked never leaves
  const people = rows ?? [];
  if (!people.length) redirect(`/admin/cvs?err=${encodeURIComponent("None of the ticked students has consented to sharing.")}`);

  // Fetch each resume; a profile without one still travels as a summary row.
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  for (const p of people) {
    const ref = String((p as { resume_url?: string }).resume_url ?? "");
    if (!ref) continue;
    try {
      const url = await resolveFileUrl(ref, 300);
      if (!url) continue;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const safe = String((p as { full_name?: string }).full_name ?? "candidate").replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "-") || "candidate";
      attachments.push({ filename: `${safe}-Resume.pdf`, content: Buffer.from(await res.arrayBuffer()), contentType: "application/pdf" });
    } catch { /* the summary row still goes */ }
  }

  const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rowsHtml = people.map((p) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #ddd"><strong>${esc(p.full_name)}</strong></td>
      <td style="padding:6px 10px;border:1px solid #ddd">${esc(p.qualification)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${esc(p.city)}${p.state ? ", " + esc(p.state) : ""}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${esc(p.email)}<br/>${esc(p.phone)}</td>
    </tr>`).join("");

  const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  const html = emailShell(
    "Candidate profiles — CA Parveen Sharma Classes",
    `${note ? `<p>${esc(note)}</p>` : ""}
     <p>Please find ${people.length === 1 ? "the profile" : `${people.length} profiles`} of our
     student${people.length === 1 ? "" : "s"} below; resume${attachments.length === 1 ? " is" : "s are"} attached.</p>
     <table style="border-collapse:collapse;font-size:14px">${rowsHtml}</table>
     <p>For anything further, reply to this email or call 98100 12674.</p>`,
  );
  const ok = attachments.length
    ? await sendEmailWithAttachment(to, "Candidate profiles — CA Parveen Sharma Classes", html, attachments)
    : await (await import("@/lib/notify")).sendEmail(to, "Candidate profiles — CA Parveen Sharma Classes", html);

  await svc.from("notifications").insert({
    student_id: null,
    channel: "email",
    template: "cv_share",
    payload: { to, students: people.map((p) => ({ id: p.student_id, name: p.full_name })), attached: attachments.length },
    status: ok ? "sent" : "failed",
    sent_at: new Date().toISOString(),
  });

  redirect(`/admin/cvs?${ok ? `sent=${people.length}` : `err=${encodeURIComponent("The email could not be sent — nothing left the building.")}`}`);
}
