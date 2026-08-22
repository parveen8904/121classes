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

// ---- Bank statements & the three queues ------------------------------------

export async function uploadStatementAction(formData: FormData) {
  await assertArea("zoho");
  const accountName = str(formData.get("account_name"));
  const file = formData.get("file") as File | null;
  if (!accountName || !file || !file.size) {
    redirect(`/admin/zoho?scan=${encodeURIComponent("Pick the account and choose a statement file.")}#bank`);
  }
  const safe = (file!.name || "statement").replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `zoho-bank/${Date.now()}-${safe}`;
  const svc = createServiceClient();
  const buf = Buffer.from(await file!.arrayBuffer());
  const { error } = await svc.storage.from("secure").upload(path, buf, {
    contentType: file!.type || "application/octet-stream", upsert: false,
  });
  if (error) redirect(`/admin/zoho?scan=${encodeURIComponent(`Upload failed: ${error.message}`)}#bank`);
  const { ingestStatement } = await import("@/lib/bankStatements");
  let note: string;
  try { note = await ingestStatement(accountName, `secure:${path}`, file!.name); }
  catch (e) { note = `Statement failed: ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#bank`);
}

export async function answerLineAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  const account = str(formData.get("account"));
  const rulePattern = str(formData.get("rule_pattern"));
  const remember = str(formData.get("remember")) === "on";
  if (!id || !account) return;
  const { postBankLine, saveMerchantRule } = await import("@/lib/bankStatements");
  if (remember && rulePattern) {
    try { await saveMerchantRule(rulePattern, account); } catch { /* the posting still proceeds */ }
  }
  try { await postBankLine(id, account); } catch { /* row carries failed + error */ }
  revalidatePath("/admin/zoho");
}

export async function approveAutoLineAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: l } = await svc.from("bank_lines").select("proposal").eq("id", id).maybeSingle();
  const account = String((l?.proposal as { account?: string } | null)?.account ?? "").trim();
  if (!account) return;
  const { postBankLine } = await import("@/lib/bankStatements");
  try { await postBankLine(id, account); } catch { /* recorded */ }
  revalidatePath("/admin/zoho");
}

export async function approveAllAutoAction() {
  await assertArea("zoho");
  const svc = createServiceClient();
  const { data: autos } = await svc.from("bank_lines").select("id, proposal").eq("status", "auto").order("line_date");
  const { postBankLine } = await import("@/lib/bankStatements");
  for (const a of autos ?? []) {
    const account = String((a.proposal as { account?: string } | null)?.account ?? "").trim();
    if (!account) continue;
    try { await postBankLine(a.id, account); } catch { /* continue */ }
  }
  revalidatePath("/admin/zoho");
}

export async function skipLineAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("bank_lines")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

export async function retryLineAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("bank_lines")
    .update({ status: "ask", error: null, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

// ---- Petty cash (managed inside the zoho area) ------------------------------

export async function addPettyPersonAction(formData: FormData) {
  await assertArea("zoho");
  const name = str(formData.get("name"));
  const email = str(formData.get("email")).toLowerCase();
  let zohoAccount = str(formData.get("zoho_account_name"));
  if (!name) return;
  const svc = createServiceClient();
  // A fresh person gets a fresh "(AI)" advance account unless an existing
  // account (Arun / Madan / Pradeep / Shripal…) is named.
  if (!zohoAccount) {
    const { ensureAdvanceAccount } = await import("@/lib/pettyCash");
    try { zohoAccount = await ensureAdvanceAccount(name); }
    catch { redirect(`/admin/zoho?scan=${encodeURIComponent("Could not create the advance account in Zoho.")}#petty`); }
  }
  let profileId: string | null = null;
  if (email) {
    const { data: prof } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
    profileId = prof?.id ?? null;
  }
  await svc.from("petty_people").insert({ name, zoho_account_name: zohoAccount, profile_id: profileId });
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(
    `${name} added (account: ${zohoAccount}).${email && !profileId ? " ⚠️ No portal login found for that email — they can't upload bills until it matches." : ""}${profileId ? " Remember to grant them the 👛 Petty cash area in Admin → Users." : ""}`)}#petty`);
}

export async function recordAdvanceAction(formData: FormData) {
  await assertArea("zoho");
  const personId = str(formData.get("person_id"));
  const amount = Number(formData.get("amount"));
  const advDate = str(formData.get("adv_date"));
  const bank = str(formData.get("bank_account_name"));
  if (!personId || !amount || amount <= 0 || !advDate || !bank) return;
  const staff = await currentStaff();
  const svc = createServiceClient();
  const { data: row } = await svc.from("petty_advances").insert({
    person_id: personId, adv_date: advDate, amount, bank_account_name: bank,
    status: "failed", created_by: staff?.id ?? null,
  }).select("id").single();
  if (!row) return;
  const { postAdvance } = await import("@/lib/pettyCash");
  try { await postAdvance(row.id); } catch { /* row carries failed + error */ }
  revalidatePath("/admin/zoho");
}

export async function approveBillAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  const expenseAccount = str(formData.get("expense_account"));
  if (!id || !expenseAccount) return;
  const staff = await currentStaff();
  await createServiceClient().from("petty_bills").update({ decided_by: staff?.id ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  const { postBill } = await import("@/lib/pettyCash");
  try { await postBill(id, expenseAccount); } catch { /* row carries failed + error */ }
  revalidatePath("/admin/zoho");
  revalidatePath("/admin/petty");
}

export async function rejectBillAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  const note = str(formData.get("note"));
  if (!id) return;
  const staff = await currentStaff();
  await createServiceClient().from("petty_bills").update({
    status: "rejected", note: note || "Rejected", decided_by: staff?.id ?? null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/admin/zoho");
  revalidatePath("/admin/petty");
}

export async function retryBillAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("petty_bills").update({ status: "pending", error: null, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

// ---- Brokerage engine -------------------------------------------------------

export async function uploadBrokerageAction(formData: FormData) {
  await assertArea("zoho");
  const accountName = str(formData.get("account_name"));
  const file = formData.get("file") as File | null;
  if (!accountName || !file || !file.size) {
    redirect(`/admin/zoho?scan=${encodeURIComponent("Pick the brokerage account and choose a statement file.")}#brokerage`);
  }
  const safe = (file!.name || "statement").replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `zoho-brokerage/${Date.now()}-${safe}`;
  const svc = createServiceClient();
  const buf = Buffer.from(await file!.arrayBuffer());
  const { error } = await svc.storage.from("secure").upload(path, buf, {
    contentType: file!.type || "application/octet-stream", upsert: false,
  });
  if (error) redirect(`/admin/zoho?scan=${encodeURIComponent(`Upload failed: ${error.message}`)}#brokerage`);
  const { ingestBrokerageStatement } = await import("@/lib/brokerage");
  let note: string;
  try { note = await ingestBrokerageStatement(accountName, `secure:${path}`, file!.name); }
  catch (e) { note = `Statement failed: ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#brokerage`);
}

export async function postBrokerageLineAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  const account = str(formData.get("account"));
  const costInr = Number(formData.get("cost_inr")) || 0;
  const plAccount = str(formData.get("pl_account"));
  const { postBrokerageLine } = await import("@/lib/brokerage");
  try {
    await postBrokerageLine(id, {
      ...(account ? { account } : {}),
      ...(costInr > 0 ? { costInr } : {}),
      ...(plAccount ? { plAccount } : {}),
    });
  } catch { /* the row carries status=failed + the reason */ }
  revalidatePath("/admin/zoho");
}

export async function approveAllBrokerageAction() {
  await assertArea("zoho");
  const svc = createServiceClient();
  const { data: autos } = await svc.from("brokerage_lines").select("id").eq("status", "auto").order("line_date");
  const { postBrokerageLine } = await import("@/lib/brokerage");
  for (const a of autos ?? []) {
    try { await postBrokerageLine(a.id, {}); } catch { /* continue */ }
  }
  revalidatePath("/admin/zoho");
}

export async function skipBrokerageLineAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("brokerage_lines")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

export async function retryBrokerageLineAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("brokerage_lines")
    .update({ status: "ask", error: null, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/zoho");
}

// ---- Tax assumptions (founder-only) ----------------------------------------

export async function saveTaxAssumptionsAction(formData: FormData) {
  await assertArea(null); // the tax worksheets are the founder's alone
  const rate = Number(formData.get("eff_rate"));
  const usTax = Number(formData.get("us_py_tax"));
  const svc = createServiceClient();
  if (rate > 0 && rate <= 60) await svc.from("site_settings").upsert({ key: "adv_tax_eff_rate", value: String(rate) }, { onConflict: "key" });
  if (usTax >= 0) await svc.from("site_settings").upsert({ key: "us_py_tax_usd", value: String(usTax) }, { onConflict: "key" });
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
