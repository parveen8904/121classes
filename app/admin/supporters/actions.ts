"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailShell } from "@/lib/notify";
import { str } from "../_lib/util";

// PUTTING A LIVE BUSINESS RELATIONSHIP ON HOLD.
//
// Every action here reaches somebody's livelihood, so each one tells them what
// happened and why, in the same breath as doing it. A seller who discovers by
// accident that they cannot place an order has been treated badly even if the
// decision was right.

const PENALTY = "₹5,000";

/** Stop a supporter placing new orders. They keep everything else. */
export async function holdSupporter(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  const reason = str(formData.get("reason"));
  if (!id || !reason) redirect("/admin/supporters?err=A reason is needed — the seller is told it");

  const svc = createServiceClient();
  const { data: who } = await svc
    .from("profiles").select("full_name, business_name, email").eq("id", id).maybeSingle();

  await svc.from("profiles").update({
    supporter_blocked_at: new Date().toISOString(),
    supporter_block_reason: reason.slice(0, 1000),
  }).eq("id", id);

  // Told at once, and told exactly what was seen. A hold discovered by trying
  // to place an order is a hold nobody can answer.
  if (who?.email) {
    const subject = "Your supporter account is on hold";
    await sendEmail(
      who.email as string,
      subject,
      emailShell(subject,
        `<p>Dear ${String(who.full_name ?? who.business_name ?? "").split(" ")[0] || "Sir/Madam"},</p>` +
        `<p>Your supporter account has been put on hold, so new orders cannot be placed for the moment.</p>` +
        `<p><strong>What was found:</strong><br/>${reason.replace(/</g, "&lt;")}</p>` +
        `<p>Everything else is untouched — you can still sign in, see your orders, download your ` +
        `invoices, and the students you have already sold to are unaffected.</p>` +
        `<p>To lift the hold, the agreed penalty of <strong>${PENALTY}</strong> is payable, and the ` +
        `page in question corrected. Please call the office on 98100 12674 to settle it.</p>` +
        `<p>If you believe this is a mistake, reply to this email and tell us — it is read by a person.</p>`),
    ).catch(() => false);
  }

  revalidatePath("/admin/supporters");
  redirect("/admin/supporters?held=1");
}

/** Lift the hold — penalty settled, or it was a mistake. */
export async function releaseSupporter(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  if (!id) return;

  const svc = createServiceClient();
  const { data: who } = await svc
    .from("profiles").select("full_name, business_name, email").eq("id", id).maybeSingle();

  await svc.from("profiles")
    .update({ supporter_blocked_at: null, supporter_block_reason: null })
    .eq("id", id);

  if (who?.email) {
    const subject = "Your supporter account is active again";
    await sendEmail(
      who.email as string,
      subject,
      emailShell(subject,
        `<p>Dear ${String(who.full_name ?? who.business_name ?? "").split(" ")[0] || "Sir/Madam"},</p>` +
        `<p>The hold on your account has been lifted. You can place orders again from your desk.</p>` +
        `<p>Thank you for sorting it out.</p>`),
    ).catch(() => false);
  }

  revalidatePath("/admin/supporters");
  redirect("/admin/supporters?released=1");
}

/**
 * Settle a complaint one supporter made about another.
 *
 * Upholding it does NOT put anybody on hold by itself. The two are separate on
 * purpose: deciding a complaint is true and deciding what to do about it are
 * different judgements, and rolling them together makes the second one
 * automatic.
 */
export async function decideComplaint(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  const verdict = str(formData.get("verdict"));
  const note = str(formData.get("note"));
  if (!id || !["upheld", "rejected"].includes(verdict)) return;

  // Whose decision it was. A complaint upheld by nobody in particular is not a
  // decision anybody can be asked about later.
  const { data: { user } } = await createClient().auth.getUser();

  const svc = createServiceClient();
  await svc.from("supporter_complaints").update({
    status: verdict,
    outcome_note: note.slice(0, 1000) || null,
    reviewed_by: user?.id ?? null,
    reviewed_at: new Date().toISOString(),
  }).eq("id", id);

  revalidatePath("/admin/supporters");
  redirect(`/admin/supporters?complaint=${verdict}`);
}

/** Read one supporter's site again, now, rather than waiting for tonight. */
export async function recheckSupporterSite(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  if (!id) return;

  const svc = createServiceClient();
  const { data: s } = await svc
    .from("profiles").select("supporter_site").eq("id", id).maybeSingle();
  const site = String(s?.supporter_site ?? "");
  if (!site) redirect("/admin/supporters?err=That supporter has no website on file");

  const { inspectSite, recordCheck } = await import("@/lib/supporterSite");
  const r = await inspectSite(site);
  await recordCheck(id, site, r);

  revalidatePath("/admin/supporters");
  redirect(`/admin/supporters?checked=${r.ok ? "clean" : (r.problem ?? "problem")}`);
}
