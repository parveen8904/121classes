"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../_lib/util";

export async function createCoupon(formData: FormData) {
  const code = str(formData.get("code")).toUpperCase().replace(/\s+/g, "");
  if (!code) return;
  const percent = num(formData.get("percent_off"), 0);
  const amount = num(formData.get("amount_off_inr"), 0);
  const maxUses = num(formData.get("max_uses"), 0);
  const scope = ["any", "user", "donor"].includes(str(formData.get("scope"))) ? str(formData.get("scope")) : "any";
  const expiry = str(formData.get("expires_at")); // yyyy-mm-dd or blank
  const forEmail = str(formData.get("for_email")).trim().toLowerCase() || null;
  const supabase = createClient();
  await supabase.from("coupons").insert({
    code,
    percent_off: percent > 0 ? Math.min(100, percent) : null,
    amount_off_inr: amount > 0 ? amount : null,
    max_uses: maxUses > 0 ? maxUses : null,
    scope,
    for_email: forEmail,
    expires_at: expiry ? new Date(expiry + "T23:59:59").toISOString() : null,
    is_active: formData.get("is_active") === "on",
  });
  revalidatePath("/admin/coupons");
}

export async function deleteCoupon(formData: FormData) {
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("coupons").delete().eq("id", id);
  revalidatePath("/admin/coupons");
}

export async function toggleCoupon(formData: FormData) {
  const id = str(formData.get("id"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("coupons").update({ is_active: next }).eq("id", id);
  revalidatePath("/admin/coupons");
}

// Email a coupon to a sponsor — just the code, a friendly note, and the Sponsor
// Guide attached as a PDF. One click; the person gets everything they need.
export async function emailCoupon(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null };
  if (me?.role !== "admin") return;
  const id = str(formData.get("id"));
  const to = str(formData.get("to")).trim().toLowerCase();
  if (!id || !to.includes("@")) { redirect("/admin/coupons?mail=bademail"); }
  const { createServiceClient } = await import("@/lib/supabase/service");
  const svc = createServiceClient();
  const { data: c } = await svc.from("coupons").select("code, percent_off, amount_off_inr, expires_at").eq("id", id).maybeSingle();
  if (!c) redirect("/admin/coupons?mail=fail");
  const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  const { buildSponsorGuidePdf } = await import("@/lib/sponsorGuide");
  const off = c!.percent_off ? `${c!.percent_off}% off` : c!.amount_off_inr ? `₹${c!.amount_off_inr} off` : "a special discount";
  const validity = c!.expires_at ? ` (valid till ${new Date(c!.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })})` : "";
  const pdf = await buildSponsorGuidePdf();
  const ok = await sendEmailWithAttachment(
    to,
    "🎁 Your sponsor coupon — CA Parveen Sharma",
    emailShell("A gift of education 🎁",
      `<p>Thank you for choosing to sponsor a CA student with CA Parveen Sharma.</p>
       <p>Your coupon code — <strong style="font-size:18px">${c!.code}</strong> — gives you <strong>${off}</strong>${validity}. Enter it at the checkout step when you sponsor.</p>
       <p>The attached <strong>Sponsor Guide</strong> explains what the student receives and the simple steps to sponsor. You can also read it online:</p>
       <p><a href="https://caparveensharma.com/sponsor-guide" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Read the Sponsor Guide</a></p>
       <p style="margin-top:14px"><a href="https://caparveensharma.com/gift">Sponsor a student now →</a></p>`),
    { filename: "Sponsor-a-Student-Guide.pdf", content: Buffer.from(pdf), contentType: "application/pdf" },
  );
  redirect(`/admin/coupons?mail=${ok ? "sent" : "fail"}`);
}
