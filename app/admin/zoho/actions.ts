"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { clearSecretCache } from "@/lib/secrets";
import { zohoExchangeGrantCode, zohoListOrganizations, zohoFetch } from "@/lib/zohoApi";
import { str } from "../_lib/util";
import { requestApprovalFor } from "@/lib/zohoApprovals";

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
  await requestApprovalFor("sale", "zoho_postings", id);
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
    await requestApprovalFor("sale", "zoho_postings", d.id);
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
  await requestApprovalFor("settlement", "zoho_settlements", id);
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
    await requestApprovalFor("settlement", "zoho_settlements", r.id);
  }
  revalidatePath("/admin/zoho");
}

export async function approveSelectedSettlementsAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  const staff = await currentStaff();
  const svc = createServiceClient();
  const { postSettlement } = await import("@/lib/zohoSettlements");
  for (const id of ids) {
    await svc.from("zoho_settlements").update({ approved_by: staff?.id ?? null, updated_at: new Date().toISOString() }).eq("id", id);
    await requestApprovalFor("settlement", "zoho_settlements", id);
  }
  revalidatePath("/admin/zoho");
}

export async function skipSelectedSettlementsAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  await createServiceClient().from("zoho_settlements")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).in("id", ids);
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

// ---- Provider invoices, by API ---------------------------------------------

export async function fetchProviderInvoicesAction() {
  await assertArea("zoho");
  const { fetchBunnyInvoices, fetchRazorpayInvoices } = await import("@/lib/providerInvoices");
  const notes: string[] = [];
  try { notes.push(await fetchBunnyInvoices()); }
  catch (e) { notes.push(`Bunny failed: ${e instanceof Error ? e.message : "unknown"}`); }
  try { notes.push(await fetchRazorpayInvoices()); }
  catch (e) { notes.push(`Razorpay failed: ${e instanceof Error ? e.message : "unknown"}`); }
  const note = notes.join(" ");
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#vault`);
}

// ---- Provider invoices → Zoho bills ----------------------------------------

export async function scanBillsAction() {
  await assertArea("zoho");
  const { scanVaultForBills } = await import("@/lib/providerBills");
  let note: string;
  try { note = await scanVaultForBills(); }
  catch (e) { note = `Bill scan failed: ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#bills`);
}

export async function readbackBillsAction() {
  // Proof, from the books themselves. Reads every posted bill back out of Zoho
  // and records what it holds — the rate it used, the totals it computed and
  // whether the reverse charge landed. Anything Zoho still holds as a DRAFT is
  // finished here, because a draft bill reaches no ledger and no GST return.
  await assertArea("zoho");
  const { readbackPostedBills } = await import("@/lib/providerBills");
  let note: string;
  try {
    const { checked, opened } = await readbackPostedBills();
    note = checked
      ? `Read ${checked} posted bill${checked === 1 ? "" : "s"} back from Zoho.` +
        (opened ? ` ${opened} was still a draft there and is now in the books.` : "")
      : "No posted bills to check yet.";
  } catch (e) { note = `Read-back failed: ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#bills`);
}

export async function recheckBillDatesAction() {
  // The date decides the GST period and the rupee value, so it is checked
  // against the paper itself — not against what was filed or typed.
  await assertArea("zoho");
  const { recheckPostedBillDates } = await import("@/lib/providerBills");
  let note: string;
  try { note = await recheckPostedBillDates(); }
  catch (e) { note = `Date check failed: ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#bills`);
}

export async function uploadBillAction(formData: FormData) {
  // THE TEAM'S OWN DOOR FOR A BILL.
  //
  // Going to the vault, filling six index fields and then pressing a second
  // button on another section is a procedure, not a workflow — and the team has
  // many bills to put in. This is one form: the supplier, the file, done. It
  // files the vault copy AND queues the bill for treatment in one action.
  await assertArea("zoho");
  const institution = str(formData.get("institution"));
  const file = formData.get("file") as File | null;
  if (!institution || !file || !file.size) {
    redirect(`/admin/zoho?scan=${encodeURIComponent("Name the supplier and choose the file.")}#bills`);
  }
  const safe = (file!.name || "invoice.pdf").replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `zoho-vault/${Date.now()}-${safe}`;
  const svc = createServiceClient();
  const buf = Buffer.from(await file!.arrayBuffer());
  const up = await svc.storage.from("secure").upload(path, buf, {
    contentType: file!.type || "application/pdf", upsert: false,
  });
  if (up.error) redirect(`/admin/zoho?scan=${encodeURIComponent(`Upload failed: ${up.error.message}`)}#bills`);

  const { data: doc } = await svc.from("zoho_vault_docs").insert({
    title: `${institution} — ${str(formData.get("title")) || file!.name}`,
    file_url: `secure:${path}`,
    institution,
    doc_type: "Invoice / bill",
    year_label: str(formData.get("year_label")) || null,
    is_processed: false,
    note: str(formData.get("note")) || "uploaded by the accounts desk",
  }).select("id").single();

  let note = "Filed in the vault.";
  if (doc) {
    const { scanVaultForBills } = await import("@/lib/providerBills");
    try { note = await scanVaultForBills(3); } catch { note = "Filed in the vault; press 🔄 to read it for the bill."; }
  }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#bills`);
}

export async function approveZohoAction(formData: FormData) {
  // THE ONLY DOOR TO ZOHO, AND ONLY HE HOLDS IT. Not the accounts desk, not a
  // cron, not this system on its own judgement.
  await assertArea(null);
  const me = await currentStaff();
  const id = str(formData.get("id"));
  if (!id) return;
  const { releaseApproval } = await import("@/lib/zohoApprovals");
  const note = await releaseApproval(id, me?.id ?? null);
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#approvals`);
}

export async function approveAllZohoAction(formData: FormData) {
  await assertArea(null);
  const me = await currentStaff();
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  const { releaseApproval } = await import("@/lib/zohoApprovals");
  let done = 0, failed = 0;
  for (const id of ids) {
    const r = await releaseApproval(id, me?.id ?? null);
    if (r.startsWith("Approved and posted")) done++; else failed++;
  }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(`${done} posted${failed ? `, ${failed} did not go through — see the reasons below` : ""}.`)}#approvals`);
}

export async function rejectZohoAction(formData: FormData) {
  await assertArea(null);
  const me = await currentStaff();
  const id = str(formData.get("id"));
  if (!id) return;
  const { rejectApproval } = await import("@/lib/zohoApprovals");
  await rejectApproval(id, me?.id ?? null, str(formData.get("note")) || undefined);
  revalidatePath("/admin/zoho");
  redirect("/admin/zoho#approvals");
}

export async function removeBillAction(formData: FormData) {
  // Take an invoice off the list. Nothing is deleted — the PDF stays in the
  // vault and the row stays with its reason, because "why is this not in the
  // books" is a question somebody will ask in March.
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("provider_bills").update({
    status: "skipped",
    error: str(formData.get("why")) || "removed by hand — not to be booked",
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/admin/zoho");
}

export async function decideBillAction(formData: FormData) {
  // ONE BUTTON FOR THE WHOLE INVOICE.
  //
  // Whatever is on the card when it is pressed IS the entry: the account, the
  // GST position, the TDS, the amount, the date. Anything changed here is
  // changed here — Zoho is never the place to correct it — and unless told
  // otherwise the corrected version becomes the rule for that vendor, so the
  // same question is not asked again next month.
  //
  // Who presses it decides what happens next. The founder pressing it IS the
  // approval, so it posts. Anyone else is asking him, and it waits.
  await assertArea("zoho");
  const me = await currentStaff();
  const isFounder = me?.role === "admin";
  const id = str(formData.get("id"));
  if (!id) return;

  const svc = createServiceClient();
  const { data: bill } = await svc.from("provider_bills").select("*").eq("id", id).maybeSingle();
  if (!bill) return;

  const expense_account = str(formData.get("expense_account"));
  const gst_treatment = str(formData.get("gst_treatment")) || "rcm";
  const gst_tax_name = str(formData.get("gst_tax_name")) || null;
  const tds_rate = formData.get("tds_rate") === null || str(formData.get("tds_rate")) === ""
    ? null : Number(formData.get("tds_rate"));
  const tds_section = str(formData.get("tds_section")) || (tds_rate ? "393(2) Sl.17" : null);
  const billDate = str(formData.get("bill_date")) || bill.bill_date;
  const amount = Number(formData.get("amount")) || Number(bill.amount);
  const rate = Number(formData.get("rate")) || Number(bill.rate) || null;
  const vendor_name = str(formData.get("vendor_name")) || String(bill.institution);

  const proposal = {
    ...(bill.proposal as Record<string, unknown> ?? {}),
    vendor_name, expense_account, gst_treatment, gst_tax_name,
    gst_rate: Number(formData.get("gst_rate")) || 18,
    tds_section, tds_rate,
  };

  await svc.from("provider_bills").update({
    bill_date: billDate, amount,
    rate, inr_amount: rate ? Number((amount * rate).toFixed(2)) : amount,
    proposal, status: "draft", error: null, updated_at: new Date().toISOString(),
  }).eq("id", id);

  // "When asked, that becomes a rule."
  if (str(formData.get("as_rule")) !== "no" && expense_account) {
    const { saveBillRule } = await import("@/lib/providerBills");
    try {
      await saveBillRule({
        institution: String(bill.institution), vendor_name, expense_account,
        gst_treatment, gst_rate: Number(formData.get("gst_rate")) || 18,
        tds_section, tds_rate, gst_tax_name,
      });
    } catch { /* the entry still stands even if the rule could not be kept */ }
  }

  if (isFounder) {
    // His press is the approval. It goes.
    const { withFounderApproval } = await import("@/lib/zohoGuard");
    const { postProviderBill } = await import("@/lib/providerBills");
    let note: string;
    try {
      await withFounderApproval(`inline:${id}`, () => postProviderBill(id));
      const { data: after } = await svc.from("provider_bills").select("status, error").eq("id", id).maybeSingle();
      if (after?.status === "posted") {
        // Read it straight back out of Zoho and finish it there if it is still a
        // draft. Proving a posting landed is part of posting it, not a chore to
        // remember afterwards.
        const { readbackPostedBills } = await import("@/lib/providerBills");
        await withFounderApproval(`inline:${id}`, () => readbackPostedBills().then(() => undefined)).catch(() => {});
        const { data: fin } = await svc.from("provider_bills").select("zoho_echo, error").eq("id", id).maybeSingle();
        const st = (fin?.zoho_echo as { zoho_status?: string } | null)?.zoho_status;
        note = st === "open" || st === "overdue" || st === "paid"
          ? "Posted to Zoho and in the ledgers."
          : `Posted to Zoho — ${fin?.error ?? "still to be opened there"}`;
      } else {
        note = `Not posted — ${after?.error ?? "see the row"}`;
      }
    } catch (e) {
      note = `Not posted — ${e instanceof Error ? e.message : "unknown"}`;
    }
    revalidatePath("/admin/zoho");
    redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#bills`);
  }

  await requestApprovalFor("provider_bill", "provider_bills", id, undefined, me?.id ?? null);
  revalidatePath("/admin/zoho");
  redirect("/admin/zoho?scan=" + encodeURIComponent("Sent to CA Parveen Sharma for approval.") + "#bills");
}

export async function saveForeignAnswersAction(formData: FormData) {
  // THE ACCOUNTS DESK ANSWERS THESE. They are questions of fact — where the
  // vendor is, what they actually did, which papers are on file — not rulings
  // on tax, which remain the founder's. The withholding, the Form 145 part and
  // whether an accountant's certificate is needed are then worked out, never
  // typed in by hand.
  await assertArea("zoho");
  const me = await currentStaff();
  const institution = str(formData.get("institution"));
  if (!institution) return;
  const svc = createServiceClient();
  const answers = {
    country: str(formData.get("country")),
    service_category: str(formData.get("service_category")) || "standardised",
    billing_frequency: str(formData.get("billing_frequency")) || "monthly",
    has_trc: formData.get("has_trc") === "on",
    has_form10f: formData.get("has_form10f") === "on",
    has_no_pe: formData.get("has_no_pe") === "on",
    has_395_cert: formData.get("has_395_cert") === "on",
    expected_annual: Number(formData.get("expected_annual")) || null,
    answered_by: me?.id ?? null,
    answered_at: new Date().toISOString(),
  };
  if (!answers.country) return;

  const { data: existing } = await svc.from("provider_bill_rules")
    .select("institution").eq("institution", institution).maybeSingle();
  if (existing) {
    await svc.from("provider_bill_rules").update(answers).eq("institution", institution);
  } else {
    // The founder's treatment ruling for foreign vendors already stands: import
    // of services under reverse charge, booked to web maintenance. The answers
    // fill in the rest of the row rather than waiting for a second form.
    await svc.from("provider_bill_rules").insert({
      institution, vendor_name: institution,
      expense_account: "Web Maintainence Expenses",
      gst_treatment: "rcm", gst_rate: 18, tds_section: null, tds_rate: null,
      ...answers,
    });
  }
  // Anything of theirs that was waiting on these answers can now be worked out.
  const { redetermineWaiting } = await import("@/lib/providerBills");
  try { await redetermineWaiting(institution); } catch { /* the rows stay waiting */ }
  revalidatePath("/admin/zoho");
  redirect("/admin/zoho#bills");
}

export async function markFormFiledAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  const which = str(formData.get("which"));
  if (!id || !["145", "146"].includes(which)) return;
  const svc = createServiceClient();
  await svc.from("provider_bills")
    .update({ [which === "145" ? "form145_filed_at" : "form146_filed_at"]: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/zoho");
}

export async function saveBillRuleAction(formData: FormData) {
  // The TREATMENT is the founder's call — GST position and TDS are his to rule
  // on, not the accounts desk's.
  await assertArea(null);
  const institution = str(formData.get("institution"));
  const vendor_name = str(formData.get("vendor_name")) || institution;
  const expense_account = str(formData.get("expense_account"));
  const gst_treatment = str(formData.get("gst_treatment")) || "rcm";
  const gst_rate = Number(formData.get("gst_rate")) || 18;
  const tds_section = str(formData.get("tds_section")) || null;
  const tds_rate = Number(formData.get("tds_rate")) || null;
  const gst_tax_name = str(formData.get("gst_tax_name")) || null;
  if (!institution || !expense_account) return;
  const { saveBillRule } = await import("@/lib/providerBills");
  try { await saveBillRule({ institution, vendor_name, expense_account, gst_treatment, gst_rate, tds_section, tds_rate, gst_tax_name }); }
  catch { /* the row stays waiting */ }
  revalidatePath("/admin/zoho");
}

export async function approveSelectedBillsAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  for (const id of ids) {
    await requestApprovalFor("provider_bill", "provider_bills", id);
  }
  revalidatePath("/admin/zoho");
}

export async function skipSelectedBillsAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  await createServiceClient().from("provider_bills")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).in("id", ids);
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
  await requestApprovalFor("bank_line", "bank_lines", id, { accountChoice: account });
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
  await requestApprovalFor("bank_line", "bank_lines", id, { accountChoice: account });
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
    await requestApprovalFor("bank_line", "bank_lines", a.id, { accountChoice: account });
  }
  revalidatePath("/admin/zoho");
}

export async function approveSelectedLinesAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  const svc = createServiceClient();
  const { postBankLine } = await import("@/lib/bankStatements");
  const { data: rows } = await svc.from("bank_lines").select("id, proposal").in("id", ids);
  for (const r of rows ?? []) {
    const account = String((r.proposal as { account?: string } | null)?.account ?? "").trim();
    if (!account) continue;
    await requestApprovalFor("bank_line", "bank_lines", r.id, { accountChoice: account });
  }
  revalidatePath("/admin/zoho");
}

export async function skipSelectedLinesAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  await createServiceClient().from("bank_lines")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).in("id", ids);
  revalidatePath("/admin/zoho");
}

export async function approveSelectedBrokerageAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  const { postBrokerageLine } = await import("@/lib/brokerage");
  for (const id of ids) {
    await requestApprovalFor("brokerage_line", "brokerage_lines", id);
  }
  revalidatePath("/admin/zoho");
}

export async function skipSelectedBrokerageAction(formData: FormData) {
  await assertArea("zoho");
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) return;
  await createServiceClient().from("brokerage_lines")
    .update({ status: "skipped", updated_at: new Date().toISOString() }).in("id", ids);
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
  // The free "any other account" box wins over the picker — retirement funds,
  // managed accounts, anything the picker's heuristics didn't list.
  const accountName = str(formData.get("account_name_other")) || str(formData.get("account_name"));
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
  const costUsd = Number(formData.get("cost_usd")) || 0;
  const plAccount = str(formData.get("pl_account"));
  const { postBrokerageLine } = await import("@/lib/brokerage");
  try {
    await postBrokerageLine(id, {
      ...(account ? { account } : {}),
      ...(costUsd > 0 ? { costUsd } : {}),
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
  // Opened to the zoho AREA on the founder's instruction (23 Aug) — Pradeep
  // files and reads documents too. Deleting stays founder-only.
  await assertArea("zoho");
  const title = str(formData.get("title"));
  const fileUrl = str(formData.get("file_url"));
  const note = str(formData.get("note"));
  const institution = str(formData.get("institution"));
  const docType = str(formData.get("doc_type"));
  const yearLabel = str(formData.get("year_label"));
  const isProcessed = str(formData.get("is_processed")) === "processed";
  if (!title || !fileUrl) return;
  const staff = await currentStaff();
  await createServiceClient().from("zoho_vault_docs").insert({
    title,
    file_url: fileUrl,
    note: note || null,
    institution: institution || null,
    doc_type: docType || null,
    year_label: yearLabel || null,
    is_processed: isProcessed,
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
