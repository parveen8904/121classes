"use server";

import { createServiceClient } from "@/lib/supabase/service";

// Site-wide lead popup: save a visitor's contact as a lead. Public endpoint by
// design (the visitor isn't logged in) — writes only, validates + dedupes, and
// never returns any stored data.
export async function capturePopupLead(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = (k: string) => { const v = formData.get(k); return typeof v === "string" ? v.trim() : ""; };
  const name = s("name").slice(0, 80);
  const email = s("email").toLowerCase().slice(0, 120);
  const phone = s("phone").replace(/\D/g, "").slice(-10);
  const page = s("page").slice(0, 120);
  if (!name) return { ok: false, error: "Please tell us your name." };
  if (!email.includes("@") && phone.length !== 10) {
    return { ok: false, error: "Please give a valid email or a 10-digit WhatsApp number." };
  }
  if (phone && phone.length !== 10) return { ok: false, error: "The WhatsApp number should be 10 digits." };

  const svc = createServiceClient();
  const [{ data: dupe }, { data: prof }] = await Promise.all([
    email
      ? svc.from("leads").select("id").eq("email", email).limit(1).maybeSingle()
      : svc.from("leads").select("id").eq("phone", phone).limit(1).maybeSingle(),
    email
      ? svc.from("profiles").select("id").eq("email", email).limit(1).maybeSingle()
      : svc.from("profiles").select("id").like("phone", `%${phone}`).limit(1).maybeSingle(),
  ]);
  if (!dupe) {
    await svc.from("leads").insert({
      name,
      email: email || null,
      phone: phone || null,
      source: "popup",
      note: page ? `popup on ${page}` : "site popup",
      matched_user_id: prof?.id ?? null,
    });
  }
  return { ok: true };
}
