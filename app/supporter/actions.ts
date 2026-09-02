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

  // THE SHOPFRONT IS MANDATORY.
  //
  // A reseller sells somewhere. Without knowing where, there is no way to check
  // that the price is honoured or that his name is not being bundled with
  // another teacher's — which is the whole basis of the arrangement.
  let site = s("supporter_site");
  if (!site) redirect("/supporter/profile?err=Your website is needed — it is where you sell, and we check it");
  if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
  try {
    const u = new URL(site);
    if (!u.hostname.includes(".")) throw new Error("no domain");
    site = u.toString();
  } catch {
    redirect("/supporter/profile?err=That does not look like a website address");
  }

  // Changing the address un-proves it: the token was published on the old one.
  const { data: before } = await svc
    .from("profiles").select("supporter_site").eq("id", supporterId).maybeSingle();
  const moved = (before?.supporter_site ?? "") !== site;

  await svc.from("profiles").update({
    full_name: s("full_name") || null,
    business_name: s("business_name") || null,
    // Who we deal with at that business, not just what it is called.
    designation: s("designation") || null,
    phone: s("phone") || null,
    email: s("email") || null,
    gstin: s("gstin").toUpperCase() || null,
    // Exactly as the GST register spells it, when a verification has run.
    trade_name: s("trade_name") || null,
    country: s("country") || "India",
    address_line1: s("address_line1") || null,
    address_line2: s("address_line2") || null,
    city: s("city") || null,
    pincode: s("pincode") || null,
    state,
    supporter_site: site,
    ...(moved ? { supporter_site_ok_at: null } : {}),
  }).eq("id", supporterId);

  revalidatePath("/supporter");
  revalidatePath("/supporter/profile");
  const next = s("next");
  redirect(next.startsWith("/") ? next : "/supporter/profile?saved=1");
}

/**
 * Prove the declared website is theirs.
 *
 * They publish a code we generate; we fetch the page and look for it. Only
 * somebody who can publish to a site can put something on it, which is the
 * whole point — anybody can type any address into a form.
 */
export async function verifySupporterSite() {
  const supporterId = await requireSupporter();
  const svc = createServiceClient();

  const { data: me } = await svc
    .from("profiles").select("supporter_site").eq("id", supporterId).maybeSingle();
  const site = String(me?.supporter_site ?? "").trim();
  if (!site) redirect("/supporter/profile?err=Add your website first");

  const { siteToken, verifyOwnership, recordCheck } = await import("@/lib/supporterSite");
  const token = siteToken(supporterId);
  const r = await verifyOwnership(site, token);
  await recordCheck(supporterId, site, r);

  if (!r.ok) {
    await svc.from("profiles").update({ supporter_site_ok_at: null }).eq("id", supporterId);
    redirect(`/supporter/profile?err=${encodeURIComponent(r.detail ?? "Could not verify the site")}`);
  }

  // Proved by the site itself, not vouched for by anybody — which is what
  // lets the nightly reader act on what it finds there.
  await svc.from("profiles")
    .update({
      supporter_site_ok_at: new Date().toISOString(),
      supporter_site_proof: "code",
      supporter_site_ok_by: null,
    })
    .eq("id", supporterId);
  revalidatePath("/supporter/profile");
  redirect("/supporter/profile?verified=1");
}

/** Record that they have read and accepted the terms. */
export async function acceptSupporterTerms(formData: FormData) {
  const supporterId = await requireSupporter();
  await createServiceClient()
    .from("profiles")
    .update({ supporter_terms_at: new Date().toISOString() })
    .eq("id", supporterId);
  revalidatePath("/supporter");
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") ? next : "/supporter");
}

/**
 * One supporter reporting another.
 *
 * Recorded, and the team told at once. Nothing happens to the reported account
 * automatically: an accusation between competitors is exactly the situation
 * where a machine should not be the judge.
 */
export async function fileSupporterComplaint(formData: FormData) {
  const supporterId = await requireSupporter();
  const svc = createServiceClient();

  const s = (k: string) => String(formData.get(k) ?? "").trim();
  let url = s("against_url");
  const what = s("what_happened");
  if (!url || !what) redirect("/supporter/complaint?err=The page address and what you saw are both needed");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // Is the reported site one of ours? Knowing that saves the team a search, and
  // decides whether there is an account to put on hold at all.
  let againstId: string | null = null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const { data } = await svc
      .from("profiles").select("id, supporter_site").ilike("supporter_site", `%${host}%`).limit(1).maybeSingle();
    againstId = (data?.id as string) ?? null;
  } catch { /* an unparseable URL is still worth recording */ }

  const ref = `CMP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  await svc.from("supporter_complaints").insert({
    ref,
    raised_by: supporterId,
    against_url: url,
    against_id: againstId,
    what_happened: what.slice(0, 4000),
    evidence_url: s("evidence_url") || null,
    status: "open",
  });

  try {
    const { notifyFaculty } = await import("@/lib/notify");
    await notifyFaculty(
      `🚩 A supporter has reported a seller (${ref})`,
      `Page: ${url}\n` +
        (againstId ? `That site belongs to one of our own supporters.\n` : `Not one of our registered supporters.\n`) +
        `\nWhat they say:\n${what}\n\n` +
        (s("evidence_url") ? `Evidence attached.\n\n` : `No evidence attached.\n\n`) +
        `Check it in Admin → Supporters → Complaints. Nothing has happened to the account.`,
    );
  } catch { /* the complaint is saved either way */ }

  revalidatePath("/supporter/complaint");
  redirect("/supporter/complaint?sent=1");
}
