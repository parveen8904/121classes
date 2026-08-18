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
// LIFTING A HOLD, WITH OR WITHOUT THE PENALTY.
//
// The site check decides holds on its own now, and it will get one wrong — it
// reads a shop page and shop pages are written by people. So the way out cannot
// be "pay ₹5,000 or stay shut": a vendor who has done nothing wrong must be
// able to have it undone at once, for nothing, by somebody who has looked.
//
// `waive` is the difference between "they paid" and "we were wrong", and the
// two are recorded differently because they mean opposite things — one is
// income, the other is a mistake worth counting. A waived hold is a signal that
// the check needs improving, and a count of them is the only way that ever
// gets noticed.
export async function releaseSupporter(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  if (!id) return;
  const waive = str(formData.get("waive")) === "1";
  const note = str(formData.get("note")).slice(0, 500);

  const svc = createServiceClient();
  const { data: who } = await svc
    .from("profiles").select("full_name, business_name, email, supporter_hold_auto, supporter_block_reason").eq("id", id).maybeSingle();
  const wasAuto = Boolean(who?.supporter_hold_auto);

  await svc.from("profiles")
    .update({
      supporter_blocked_at: null, supporter_block_reason: null,
      supporter_hold_auto: null, supporter_hold_evidence: null,
      // Waived means there is nothing to pay — not a debt carried quietly on
      // the account to surface at the next hold.
      ...(waive ? { supporter_penalty_inr: null } : {}),
    })
    .eq("id", id);

  const { data: open } = await svc
    .from("supporter_holds").select("id")
    .eq("supporter_id", id).is("released_at", null)
    .order("held_at", { ascending: false }).limit(1).maybeSingle();
  if (open?.id) {
    await svc.from("supporter_holds").update({
      released_at: new Date().toISOString(),
      release_note: waive
        ? `WAIVED by the office — no penalty taken.${note ? ` ${note}` : ""}`
        : `Released by the office.${note ? ` ${note}` : ""}`,
    }).eq("id", open.id);
  }

  if (who?.email) {
    const subject = waive
      ? "The hold on your account was a mistake — you are selling again"
      : "Your supporter account is active again";
    await sendEmail(
      who.email as string,
      subject,
      emailShell(subject,
        `<p>Dear ${String(who.full_name ?? who.business_name ?? "").split(" ")[0] || "Sir/Madam"},</p>` +
        (waive
          ? `<p>We have looked at your page ourselves and the hold should not have been placed. It has been lifted and
              <strong>there is nothing to pay</strong> — please ignore any earlier mention of a penalty.</p>
             <p>Our apologies for the interruption. You can place orders again from your desk.</p>`
          : `<p>The hold on your account has been lifted. You can place orders again from your desk.</p>
             <p>Thank you for sorting it out.</p>`) +
        (note ? `<p>${note}</p>` : "")),
    ).catch(() => false);
  }

  // A hold the machine made and a person then undid is the only evidence that
  // the check is misreading pages. Counting them is how that gets fixed.
  if (waive && wasAuto) {
    const { notifyFaculty } = await import("@/lib/notify");
    await notifyFaculty(
      "↩️ An automatic hold was waived",
      `${who?.business_name || who?.full_name || id}\n\n` +
      `The site check held this account for:\n  ${who?.supporter_block_reason ?? "—"}\n\n` +
      `A person read the page and disagreed; no penalty was taken.${note ? `\n\nNote: ${note}` : ""}\n\n` +
      `If this keeps happening the check is misreading pages and wants looking at.`,
    ).catch(() => {});
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

/**
 * Vouch for a vendor's website yourself, without waiting for the code.
 *
 * Publishing a token is proof, and proof is better. But it is also a vendor
 * being asked to edit a footer before they may sell anything, and for a vendor
 * the office has known for years that is a queue for no reason — so a person
 * can simply say "this is their site" and let them trade.
 *
 * Recorded as `admin` rather than `code`, because it is a DIFFERENT CLAIM: one
 * says the site answered with our token, the other says somebody vouched for
 * it. The nightly reader treats them differently on purpose — it will not take
 * ₹5,000 off anybody over a page we were only told belongs to them.
 */
export async function clearSupporterSiteByHand(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  if (!id) return;

  const svc = createServiceClient();
  const { data: s } = await svc
    .from("profiles").select("supporter_site").eq("id", id).maybeSingle();
  const site = String(s?.supporter_site ?? "").trim();
  if (!site) redirect("/admin/supporters?err=Add their website first — there is nothing to vouch for");

  const { data: { user } } = await createClient().auth.getUser();

  await svc.from("profiles").update({
    supporter_site_ok_at: new Date().toISOString(),
    supporter_site_proof: "admin",
    supporter_site_ok_by: user?.id ?? null,
  }).eq("id", id);

  // The site checks are the record of how each vendor came to be trusted, so
  // this belongs in the same place as every automatic reading.
  const { recordCheck } = await import("@/lib/supporterSite");
  await recordCheck(id, site, {
    ok: true,
    detail: "Cleared by the office without the code — vouched for by a person, not proved by the site.",
  });

  revalidatePath("/admin/supporters");
  redirect("/admin/supporters?vouched=1");
}

// WHAT THE NIGHTLY READ FOUND, DECIDED BY A PERSON.
//
// The founder's instruction of 18 August: the machine tells us the fault, we
// check the fault, and only then does the mail go. These two actions are that
// sentence. Sending is deliberately the plainer of the two — dismissing needs
// nothing typed, because the easy path must be the one that sends nothing.

/** Send a drafted warning: somebody has opened the page and agrees. */
export async function approveWarning(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  if (!id) return;

  const { data: { user } } = await createClient().auth.getUser();
  const { sendDraftedWarning } = await import("@/lib/supporterWarn");
  const outcome = await sendDraftedWarning(id, user?.id ?? null);

  revalidatePath("/admin/supporters");
  if (!outcome.sent) redirect(`/admin/supporters?err=${encodeURIComponent(`Not sent — ${outcome.reason}`)}`);
  redirect(`/admin/supporters?warned=${outcome.number}${outcome.emailed ? "" : "&noemail=1"}`);
}

/** Throw a drafted warning away: the page is fine, or the machine misread it. */
export async function rejectWarning(formData: FormData) {
  await assertArea("store");
  const id = str(formData.get("id"));
  if (!id) return;

  const { data: { user } } = await createClient().auth.getUser();
  const { dismissDraftedWarning } = await import("@/lib/supporterWarn");
  await dismissDraftedWarning(id, user?.id ?? null, str(formData.get("reason")));

  revalidatePath("/admin/supporters");
  redirect("/admin/supporters?dismissed=1");
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
