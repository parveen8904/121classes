"use server";
import { formatDate } from "@/lib/dates";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../_lib/util";
import { assertArea } from "@/lib/adminAccess";

export async function createCoupon(formData: FormData) {
  await assertArea(null);
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

export async function editCoupon(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  const code = str(formData.get("code")).toUpperCase().replace(/\s+/g, "");
  const percent = num(formData.get("percent_off"), 0);
  const amount = num(formData.get("amount_off_inr"), 0);
  const maxUses = num(formData.get("max_uses"), 0);
  const scope = ["any", "user", "donor"].includes(str(formData.get("scope"))) ? str(formData.get("scope")) : "any";
  const expiry = str(formData.get("expires_at")); // yyyy-mm-dd or blank
  const forEmail = str(formData.get("for_email")).trim().toLowerCase() || null;
  const supabase = createClient();
  const update: Record<string, unknown> = {
    percent_off: percent > 0 ? Math.min(100, percent) : null,
    amount_off_inr: amount > 0 ? amount : null,
    max_uses: maxUses > 0 ? maxUses : null,
    scope,
    for_email: forEmail,
    expires_at: expiry ? new Date(expiry + "T23:59:59").toISOString() : null,
    is_active: formData.get("is_active") === "on",
  };
  if (code) update.code = code;
  await supabase.from("coupons").update(update).eq("id", id);
  revalidatePath("/admin/coupons");
  redirect("/admin/coupons?mail=edited");
}

export async function deleteCoupon(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("coupons").delete().eq("id", id);
  revalidatePath("/admin/coupons");
}

export async function toggleCoupon(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("coupons").update({ is_active: next }).eq("id", id);
  revalidatePath("/admin/coupons");
}

// Email a coupon to a sponsor — just the code, a friendly note, and the Sponsor
// Guide attached as a PDF. One click; the person gets everything they need.
export async function emailCoupon(formData: FormData) {
  await assertArea(null);
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null };
  if (me?.role !== "admin") return;
  const id = str(formData.get("id"));
  const to = str(formData.get("to")).trim().toLowerCase();
  if (!id || !to.includes("@")) { redirect("/admin/coupons?mail=bademail"); }
  const { createServiceClient } = await import("@/lib/supabase/service");
  const svc = createServiceClient();
  const { data: c } = await svc.from("coupons").select("code, percent_off, amount_off_inr, expires_at, scope").eq("id", id).maybeSingle();
  if (!c) redirect("/admin/coupons?mail=fail");
  const { sendTemplate } = await import("@/lib/emailTemplates");
  const off = c!.percent_off ? `${c!.percent_off}% off` : c!.amount_off_inr ? `₹${c!.amount_off_inr} off` : "a special discount";
  const validity = c!.expires_at ? ` (valid till ${formatDate(c!.expires_at)})` : "";
  // A gifter always gets the Sponsor Guide. Treat the recipient as a gifter if
  // the coupon is donor-scoped OR the email belongs to a sponsor account.
  const { data: recipient } = await svc.from("profiles").select("account_type").eq("email", to).maybeSingle();
  const isGifter = c!.scope === "donor" || recipient?.account_type === "sponsor";
  let ok = false;
  if (isGifter) {
    // Sponsor coupon → attach the Sponsor Guide.
    const { buildSponsorGuidePdf } = await import("@/lib/sponsorGuide");
    const pdf = await buildSponsorGuidePdf();
    ok = await sendTemplate("coupon_sponsor", to,
      {
        heading: "A gift of education 🎁",
        code: c!.code, discount: off, validity,
        action_url: "https://caparveensharma.com/gift", action_label: "Sponsor a student now →",
      },
      { filename: "Sponsor-a-Student-Guide.pdf", content: Buffer.from(pdf), contentType: "application/pdf" });
  } else {
    // Student / general coupon → a plain discount email.
    ok = await sendTemplate("coupon_sent", to, {
      heading: "Here's a little help 💚",
      code: c!.code, discount: off, validity,
      action_url: "https://caparveensharma.com/courses", action_label: "Explore courses →",
    });
  }
  redirect(`/admin/coupons?mail=${ok ? "sent" : "fail"}`);
}
