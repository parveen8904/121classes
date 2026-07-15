"use server";

import { createServiceClient } from "@/lib/supabase/service";

type Result = { ok: boolean; error?: string; already?: boolean };

const SRC_TO_HEARD: Record<string, string> = {
  yt: "youtube", youtube: "youtube",
  wa: "whatsapp", whatsapp: "whatsapp",
  ig: "instagram", instagram: "instagram",
  tg: "telegram", telegram: "telegram",
};

function s(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

// Free-planner lead capture: save the contact as a LEAD first (so we keep it
// even if they never finish email verification), then start the normal
// verified signup. The ?src= tag flows into profiles.heard_from so the
// insights page shows which platform brought them.
export async function registerFromLanding(formData: FormData): Promise<Result> {
  const name = s(formData.get("name"));
  const email = s(formData.get("email")).toLowerCase();
  const phone = s(formData.get("phone")).replace(/\D/g, "").slice(-10);
  const level = s(formData.get("level"));
  const src = SRC_TO_HEARD[s(formData.get("src")).toLowerCase()] ?? (s(formData.get("src")) ? "other" : "");
  if (!name || !email.includes("@")) return { ok: false, error: "Please enter your name and a valid email." };
  if (phone && phone.length !== 10) return { ok: false, error: "Please enter a valid 10-digit mobile number." };

  const svc = createServiceClient();

  // 1) Keep the contact as a lead (deduped; linked if they're already a student).
  const [{ data: dupe }, { data: prof }] = await Promise.all([
    svc.from("leads").select("id").eq("email", email).limit(1).maybeSingle(),
    svc.from("profiles").select("id").eq("email", email).limit(1).maybeSingle(),
  ]);
  if (!dupe) {
    await svc.from("leads").insert({
      name, email, phone: phone || null, level: level || null,
      source: "landing", note: src ? `came via ${src}` : null,
      matched_user_id: prof?.id ?? null,
    });
  }
  if (prof) return { ok: true, already: true };

  // 2) Start the real verified signup (same flow as the login page).
  const fd = new FormData();
  fd.set("name", name);
  fd.set("email", email);
  fd.set("phone", phone);
  const { registerWithVerification } = await import("@/app/auth/email-actions");
  const r = await registerWithVerification(fd);
  if (!r.ok) {
    const already = (r.error ?? "").toLowerCase().includes("already");
    return already ? { ok: true, already: true } : r;
  }

  // 3) Tag where they came from (profile row exists as soon as the auth user does).
  if (src) {
    try {
      await svc.from("profiles").update({ heard_from: src }).eq("email", email);
    } catch { /* attribution is best-effort */ }
  }
  return { ok: true };
}
