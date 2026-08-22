"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { clearSecretCache } from "@/lib/secrets";
import { zohoExchangeGrantCode, zohoListOrganizations, zohoFetch } from "@/lib/zohoApi";
import { str } from "../_lib/util";

// ---- Connect Zoho Books (the Self-Client key) -------------------------------
//
// The founder pastes the client id, client secret and a fresh 10-minute grant
// code from api-console.zoho.in. The SERVER exchanges the code for the
// long-lived refresh token and stores everything in app_secrets — the values
// go founder's console → founder's portal, touching nothing in between.
// On success it also creates the desk's own "(AI)"-suffixed accounts
// (never touching any existing account) and points the payment export's
// Deposit To at the new clearing account.

async function saveSecret(key: string, value: string) {
  await createServiceClient().from("app_secrets").upsert({ key, value }, { onConflict: "key" });
}

// ---- The posting queue (the zoho area works these — Pradeep's desk) ---------

export async function scanSalesAction() {
  await assertArea("zoho");
  const { scanPortalSales } = await import("@/lib/zohoPosting");
  let note: string;
  try { note = await scanPortalSales(); } catch (e) { note = `Scan failed: ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#queue`);
}

export async function approvePostingAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  const staff = await currentStaff();
  const svc = createServiceClient();
  await svc.from("zoho_postings").update({ approved_by: staff?.id ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  const { postSale } = await import("@/lib/zohoPosting");
  try { await postSale(id); } catch { /* the row now carries status=failed + the error text */ }
  revalidatePath("/admin/zoho");
}

export async function approveAllDraftsAction() {
  await assertArea("zoho");
  const staff = await currentStaff();
  const svc = createServiceClient();
  const { data: drafts } = await svc.from("zoho_postings").select("id").eq("status", "draft").order("order_no");
  const { postSale } = await import("@/lib/zohoPosting");
  for (const d of drafts ?? []) {
    await svc.from("zoho_postings").update({ approved_by: staff?.id ?? null, updated_at: new Date().toISOString() }).eq("id", d.id);
    try { await postSale(d.id); } catch { /* recorded on the row; continue with the rest */ }
  }
  revalidatePath("/admin/zoho");
}

export async function skipPostingAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("zoho_postings")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

// ---- Razorpay settlements queue --------------------------------------------

export async function scanSettlementsAction() {
  await assertArea("zoho");
  const { scanSettlements } = await import("@/lib/zohoSettlements");
  let note: string;
  try { note = await scanSettlements(); } catch (e) { note = `Settlement scan failed: ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#settlements`);
}

export async function approveSettlementAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  const staff = await currentStaff();
  const svc = createServiceClient();
  await svc.from("zoho_settlements").update({ approved_by: staff?.id ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  const { postSettlement } = await import("@/lib/zohoSettlements");
  try { await postSettlement(id); } catch { /* row carries status=failed + error */ }
  revalidatePath("/admin/zoho");
}

export async function approveAllSettlementsAction() {
  await assertArea("zoho");
  const staff = await currentStaff();
  const svc = createServiceClient();
  const { data: rows } = await svc.from("zoho_settlements").select("id").eq("status", "draft").order("settled_on");
  const { postSettlement } = await import("@/lib/zohoSettlements");
  for (const r of rows ?? []) {
    await svc.from("zoho_settlements").update({ approved_by: staff?.id ?? null, updated_at: new Date().toISOString() }).eq("id", r.id);
    try { await postSettlement(r.id); } catch { /* continue */ }
  }
  revalidatePath("/admin/zoho");
}

export async function skipSettlementAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("zoho_settlements")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

export async function retrySettlementAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("zoho_settlements")
    .update({ status: "draft", error: null, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

export async function retryPostingAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  // Back to draft so the payload refresh + approve path runs again cleanly.
  await createServiceClient().from("zoho_postings")
    .update({ status: "draft", error: null, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

async function ensureAiAccount(name: string, accountType: string): Promise<string> {
  // Idempotent: if an account with this exact name exists, do nothing.
  type Row = { account_name: string };
  const found = await zohoFetch<{ chartofaccounts?: Row[] }>("/chartofaccounts", { query: { search_text: name } });
  if ((found.chartofaccounts ?? []).some((a) => a.account_name === name)) return "exists";
  await zohoFetch("/chartofaccounts", { method: "POST", body: { account_name: name, account_type: accountType } });
  return "created";
}

export async function connectZoho(formData: FormData) {
  await assertArea(null);
  const clientId = str(formData.get("client_id")).trim();
  const clientSecret = str(formData.get("client_secret")).trim();
  const code = str(formData.get("grant_code")).trim();
  if (!clientId || !clientSecret || !code) {
    redirect("/admin/zoho?zoho_err=" + encodeURIComponent("All three boxes are needed — client id, client secret and a fresh code."));
  }

  const ex = await zohoExchangeGrantCode(clientId, clientSecret, code);
  if (!ex.ok) redirect("/admin/zoho?zoho_err=" + encodeURIComponent(ex.error));

  await saveSecret("ZOHO_CLIENT_ID", clientId);
  await saveSecret("ZOHO_CLIENT_SECRET", clientSecret);
  await saveSecret("ZOHO_REFRESH_TOKEN", (ex as { refreshToken: string }).refreshToken);
  clearSecretCache();

  // Pick the organisation — ALDINECA (60024616913) when present, else the first.
  // NOTE: redirect() throws, so it must never sit inside a try whose catch
  // would swallow it — collect the error first, redirect after.
  let orgNote = "";
  let orgErr = "";
  try {
    const orgs = await zohoListOrganizations();
    const pick = orgs.find((o) => o.organization_id === "60024616913") ?? orgs[0];
    if (!pick) throw new Error("no organisations visible to this credential");
    await saveSecret("ZOHO_ORG_ID", pick.organization_id);
    clearSecretCache();
    orgNote = pick.name;
  } catch (e) {
    orgErr = e instanceof Error ? e.message : "unknown";
  }
  if (orgErr) {
    redirect("/admin/zoho?zoho_err=" + encodeURIComponent(`Connected, but could not read your organisations: ${orgErr}`));
  }

  // The desk's own accounts — created fresh with the (AI) suffix, never
  // touching an existing account (founder's rule). Best effort: a failure here
  // must not undo a successful connection.
  const made: string[] = [];
  try {
    // A clearing account wants to be a bank-type account so payments can
    // deposit into it; some Zoho editions refuse bank creation by API, in
    // which case fall back to a current-asset account (same accounting).
    try {
      made.push(`Razorpay Clearing (AI): ${await ensureAiAccount("Razorpay Clearing (AI)", "bank")}`);
    } catch {
      made.push(`Razorpay Clearing (AI): ${await ensureAiAccount("Razorpay Clearing (AI)", "other_current_asset")}`);
    }
    made.push(`Payment Gateway Charges (AI): ${await ensureAiAccount("Payment Gateway Charges (AI)", "expense")}`);
    // From now on the payments export deposits into the (AI) clearing account.
    await saveSecret("ZOHO_DEPOSIT_TO", "Razorpay Clearing (AI)");
    clearSecretCache();
  } catch (e) {
    made.push(`account creation: ${e instanceof Error ? e.message : "failed"} (can be retried later)`);
  }

  revalidatePath("/admin/zoho");
  redirect("/admin/zoho?zoho_ok=" + encodeURIComponent(`Connected to ${orgNote}. ${made.join(" · ")}`));
}

// THE FOUNDER-ONLY DOCUMENT VAULT.
//
// ITRs, 1040s, tax computations — the most sensitive papers on the whole
// portal. Every action here is super-admin only (assertArea(null)); the Zoho
// *area* grant (Pradeep's) deliberately does NOT reach the vault. Files are
// opened through /api/zoho-vault, which re-checks role=admin on every request —
// NOT through the general /api/file proxy, which any logged-in student can use.

export async function addVaultDoc(formData: FormData) {
  await assertArea(null);
  const title = str(formData.get("title"));
  const fileUrl = str(formData.get("file_url"));
  const note = str(formData.get("note"));
  if (!title || !fileUrl) return;
  const staff = await currentStaff();
  await createServiceClient().from("zoho_vault_docs").insert({
    title,
    file_url: fileUrl,
    note: note || null,
    uploaded_by: staff?.id ?? null,
  });
  revalidatePath("/admin/zoho");
}

export async function deleteVaultDoc(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  // The row goes; the file in storage is left in place deliberately — a tax
  // paper is never destroyed by a mis-click. Storage cleanup is a manual act.
  await createServiceClient().from("zoho_vault_docs").delete().eq("id", id);
  revalidatePath("/admin/zoho");
}
