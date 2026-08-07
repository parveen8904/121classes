"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFaculty } from "@/lib/notify";

// A supporter naming the students they intend to pay for.
//
// This is the half of sponsorship that had no home. The gift itself is a
// checkout; deciding WHO to gift to is a conversation that used to happen over
// the phone and get lost. A regular sponsor can now write the list down as it
// forms, and the office turns each one into a gift.

async function requireSupporter(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter");
  const { data: me } = await createServiceClient()
    .from("profiles").select("is_supporter, role").eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "supporter" && me?.role !== "admin") redirect("/dashboard");
  return user.id;
}

export async function addSupporterLead(formData: FormData) {
  const supporterId = await requireSupporter();

  const full_name = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const level = String(formData.get("level") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!full_name) redirect("/supporter?err=The student needs a name");
  // Somebody has to be reachable, or the office cannot act on it.
  if (!phone && !email) redirect("/supporter?err=Add a phone number or an email — otherwise we cannot reach them");

  const svc = createServiceClient();
  const { error } = await svc.from("supporter_leads").insert({
    supporter_id: supporterId, full_name, phone, email, level, note,
  });
  if (error) redirect("/supporter?err=Could not save it. Please try once more.");

  const { data: me } = await svc.from("profiles").select("full_name, email").eq("id", supporterId).maybeSingle();
  await notifyFaculty(
    "A supporter has named a student to sponsor",
    `Supporter: ${me?.full_name ?? me?.email ?? supporterId}\n\n` +
      `Student: ${full_name}\nPhone: ${phone ?? "—"}\nEmail: ${email ?? "—"}\nLevel: ${level ?? "—"}\n` +
      `${note ? `\nNote: ${note}\n` : ""}` +
      `\nOpen Admin → Users to set the gift up.`,
  ).catch(() => {});

  revalidatePath("/supporter");
  redirect("/supporter?added=1");
}

export async function removeSupporterLead(formData: FormData) {
  const supporterId = await requireSupporter();
  const id = String(formData.get("id") ?? "");
  if (id) {
    // Scoped to the owner: a supporter can only withdraw their own name, and
    // only while nobody has acted on it.
    await createServiceClient()
      .from("supporter_leads").delete()
      .eq("id", id).eq("supporter_id", supporterId).eq("status", "new");
  }
  revalidatePath("/supporter");
  redirect("/supporter?removed=1");
}

/**
 * A supporter's own details, saved once and used on every invoice afterwards.
 *
 * Deliberately narrow: name, phone, email, and the billing block. No attempt,
 * no target exam, no study plan — those belong to a student, and a supporter
 * being asked for them is being asked to pretend to be one.
 */
export async function saveSupporterProfile(formData: FormData) {
  const supporterId = await requireSupporter();
  const svc = createServiceClient();

  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const state = s("state");
  if (!state) redirect("/supporter/profile?err=Your state is needed — it decides the tax on your invoices");

  await svc.from("profiles").update({
    full_name: s("full_name") || null,
    business_name: s("business_name") || null,
    phone: s("phone") || null,
    email: s("email") || null,
    gstin: s("gstin").toUpperCase() || null,
    address_line1: s("address_line1") || null,
    address_line2: s("address_line2") || null,
    city: s("city") || null,
    pincode: s("pincode") || null,
    state,
  }).eq("id", supporterId);

  revalidatePath("/supporter");
  revalidatePath("/supporter/profile");
  const next = s("next");
  redirect(next.startsWith("/") ? next : "/supporter/profile?saved=1");
}
