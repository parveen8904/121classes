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
  await requestApprovalFor("sale", "zoho_postings", id);
  revalidatePath("/admin/zoho");
}

export async function approveAllDraftsAction() {
  await assertArea("zoho");
  const staff = await currentStaff();
  const svc = createServiceClient();
  const { data: drafts } = await svc.from("zoho_postings").select("id").eq("status", "draft").order("order_no");
  for (const d of drafts ?? []) {
    await svc.from("zoho_postings").update({ approved_by: staff?.id ?? null, updated_at: new Date().toISOString() }).eq("id", d.id);
    await requestApprovalFor("sale", "zoho_postings", d.id);
  }
  revalidatePath("/admin/zoho");
}

/**
 * EDIT THE TWO THINGS ON A SALE THAT ARE OURS TO DECIDE.
 *
 * His spec: every queue shows its journal entry with editable fields. On a
 * portal sale almost nothing is honestly editable — the amount is the money
 * Razorpay actually collected, the customer is whoever paid, the invoice
 * number is the portal's own series. What IS ours: the buyer's state (which
 * decides CGST+SGST against IGST and the place of supply) and which income
 * ledger the sale belongs to. Both are read from the payload by postSale, so
 * an edit here is exactly what gets posted — not a cosmetic overlay.
 */
export async function editSalePayloadAction(formData: FormData) {
  await assertArea("zoho");
  const id = str(formData.get("id"));
  const stateName = str(formData.get("state_name"));
  const salesAccount = str(formData.get("sales_account"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: row } = await svc.from("zoho_postings").select("status, payload").eq("id", id).maybeSingle();
  // Only before it is sent up. After approval the entry he released is the
  // entry that posts; editing underneath it would make his approval a lie.
  if (!row || !["draft", "needs_info", "failed"].includes(String(row.status))) return;
  // THE STATUS ALONE DOES NOT SAY "SENT". A sale keeps status=draft while its
  // approval request sits at his gate — seen live on #10115, editable in the
  // queue at the same moment it was waiting on him. What he approves must be
  // what posts, so a pending request locks the payload too.
  const { data: pending } = await svc.from("zoho_approvals")
    .select("id").eq("kind", "sale").eq("ref_id", id).eq("status", "pending").maybeSingle();
  if (pending) return;
  const { zohoStateCode } = await import("@/lib/indiaStates");
  const payload = {
    ...(row.payload as Record<string, unknown> ?? {}),
    ...(stateName ? { stateCode: zohoStateCode(stateName) } : {}),
    // The ledger as typed or picked — his ruling: sales are of various types
    // (previous teachers' courses among them), so this is any income ledger,
    // not a pair. Cleared by saving it empty.
    salesAccount: salesAccount || null,
  };
  await svc.from("zoho_postings").update({ payload, updated_at: new Date().toISOString() }).eq("id", id);
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
  await requestApprovalFor("settlement", "zoho_settlements", id);
  revalidatePath("/admin/zoho");
}

export async function approveAllSettlementsAction() {
  await assertArea("zoho");
  const staff = await currentStaff();
  const svc = createServiceClient();
  const { data: rows } = await svc.from("zoho_settlements").select("id").eq("status", "draft").order("settled_on");
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

export async function raiseDocumentAction(formData: FormData) {
  // WHAT WE RAISE — an invoice, a credit note, or a journal entry.
  //
  // Prepared here with the same questions the incoming side asks, then it waits
  // for him exactly as everything else does. The founder pressing the button IS
  // the approval and it posts; anyone else is asking.
  await assertArea("zoho");
  const me = await currentStaff();
  const isFounder = me?.role === "admin";
  const kind = str(formData.get("kind")) || "invoice";
  const svc = createServiceClient();

  const amount = Number(formData.get("amount")) || 0;
  const rate = Number(formData.get("rate")) || null;
  const currency = str(formData.get("currency")) || "INR";

  // A journal carries its own lines; everything else carries a party.
  const lines: { account: string; side: string; amount: number; note?: string; nature?: string; operating?: string }[] = [];
  if (kind === "journal") {
    for (let i = 0; i < 6; i++) {
      const acc = str(formData.get(`jl_account_${i}`));
      const amt = Number(formData.get(`jl_amount_${i}`)) || 0;
      if (!acc || !amt) continue;
      lines.push({
        account: acc, side: str(formData.get(`jl_side_${i}`)) === "credit" ? "credit" : "debit",
        amount: amt, note: str(formData.get(`jl_note_${i}`)) || undefined,
        nature: str(formData.get(`jl_nature_${i}`)) || "expense",
        operating: str(formData.get(`jl_operating_${i}`)) || "operating",
      });
    }
    if (lines.length < 2) {
      redirect("/admin/zoho?scan=" + encodeURIComponent("A journal needs at least two lines with an account and an amount.") + "#raise");
    }
  }

  // The voucher, if he attached one — filed in the vault first so it survives
  // whatever happens to the posting.
  let paperRef: string | null = null, paperName: string | null = null;
  const paper = formData.get("paper") as File | null;
  if (paper && paper.size) {
    const safe = (paper.name || "voucher.pdf").replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `zoho-vouchers/${Date.now()}-${safe}`;
    const up = await svc.storage.from("secure").upload(path, Buffer.from(await paper.arrayBuffer()), {
      contentType: paper.type || "application/pdf", upsert: false,
    });
    if (!up.error) { paperRef = `secure:${path}`; paperName = paper.name; }
  }

  const { data: made } = await svc.from("zoho_documents").insert({
    kind,
    file_url: paperRef, file_name: paperName,
    party_name: str(formData.get("party_name")) || null,
    party_gstin: str(formData.get("party_gstin")) || null,
    party_state: str(formData.get("party_state")) || null,
    doc_date: str(formData.get("doc_date")) || new Date().toISOString().slice(0, 10),
    doc_no: str(formData.get("doc_no")) || null,
    reference: str(formData.get("reference")) || null,
    description: str(formData.get("description")) || null,
    amount: kind === "journal" ? lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0) : amount,
    currency, rate,
    inr_amount: kind === "journal"
      ? lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0)
      : rate ? Number((amount * rate).toFixed(2)) : amount,
    nature: str(formData.get("nature")) || "income",
    operating: str(formData.get("operating")) || "operating",
    ledger: str(formData.get("ledger")) || null,
    sub_account: str(formData.get("sub_account")) || null,
    gst_treatment: str(formData.get("gst_treatment")) || "charged",
    gst_rate: Number(formData.get("gst_rate")) || 18,
    tds_rate: Number(formData.get("tds_rate")) || null,
    tds_section: str(formData.get("tds_section")) || null,
    journal_lines: kind === "journal" ? lines : null,
    created_by: me?.id ?? null,
  }).select("id").single();

  if (!made?.id) {
    redirect("/admin/zoho?scan=" + encodeURIComponent("That could not be saved — please try again.") + "#raise");
  }

  // Raised here, released at the gate — even by him. See decideBillAction.
  await requestApprovalFor("outgoing", "zoho_documents", String(made.id), undefined, me?.id ?? null);
  revalidatePath("/admin/zoho");
  redirect("/admin/zoho?scan=" + encodeURIComponent(
    isFounder ? "Raised and sent to your approval gate." : "Sent to CA Parveen Sharma for approval.",
  ) + "#approvals");
}

export async function retryDocumentAction(formData: FormData) {
  await assertArea("zoho");
  const me = await currentStaff();
  const id = str(formData.get("id"));
  if (!id) return;
  {
    // A retry is a fresh attempt to post, so it asks again like any other.
    await requestApprovalFor("outgoing", "zoho_documents", id, undefined, me?.id ?? null);
  }
  revalidatePath("/admin/zoho");
}

export async function attachPaperAction(formData: FormData) {
  // FOR AN ENTRY ALREADY IN THE BOOKS. Bills posted before this existed have
  // their invoice in the vault and nothing in Zoho pointing at it.
  await assertArea("zoho");
  const me = await currentStaff();
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: b } = await svc.from("provider_bills")
    .select("institution, bill_no, zoho_bill_id, vault_doc_id").eq("id", id).maybeSingle();
  if (!b?.zoho_bill_id || !b.vault_doc_id) return;
  const { data: doc } = await svc.from("zoho_vault_docs").select("file_url").eq("id", b.vault_doc_id).maybeSingle();
  if (!doc?.file_url) return;

  if (me?.role !== "admin") {
    revalidatePath("/admin/zoho");
    redirect("/admin/zoho?scan=" + encodeURIComponent("Attaching a file changes the books, so it needs CA Parveen Sharma.") + "#bills");
  }

  const { withFounderApproval } = await import("@/lib/zohoGuard");
  const { attachToZoho } = await import("@/lib/zohoAttach");
  const att = await withFounderApproval(`attach:${id}`, () =>
    attachToZoho("bill", String(b.zoho_bill_id), String(doc.file_url), `${b.institution}-${b.bill_no ?? "invoice"}.pdf`));
  await svc.from("provider_bills").update({
    paper_note: att.ok ? null : `the invoice is not attached (${att.note})`,
  }).eq("id", id);
  // ASK ZOHO WHETHER IT ACTUALLY HAS THE FILE, rather than believing our own
  // upload. Without this the desk forgets: it recorded nothing on success, so
  // the row went on offering to attach an invoice that was already attached.
  if (att.ok) {
    const { refreshBillEcho } = await import("@/lib/providerBills");
    await refreshBillEcho(id, String(b.zoho_bill_id));
  }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(att.ok ? "The invoice is now attached to that bill in Zoho." : `Not attached — ${att.note}`)}#bills`);
}

export async function ingestActivityCsvAction(formData: FormData) {
  // THE BROKER'S OWN ACTIVITY FILE → THE WORKING NOTE HE CHECKS → the entry.
  // Read exactly, not by guesswork: the codes in the file say what each line is.
  await assertArea("zoho");
  const account = str(formData.get("account_name_other")) || str(formData.get("account_name"));
  const from = str(formData.get("from"));
  const to = str(formData.get("to"));
  const file = formData.get("file") as File | null;
  if (!account || !file || !file.size || !from || !to) {
    redirect(`/admin/zoho?scan=${encodeURIComponent("Pick the account, the period, and the activity file.")}#brokerage`);
  }

  const safe = (file!.name || "activity.csv").replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `zoho-brokerage/${Date.now()}-${safe}`;
  const svc = createServiceClient();
  const buf = Buffer.from(await file!.arrayBuffer());
  const { error } = await svc.storage.from("secure").upload(path, buf, {
    contentType: file!.type || "text/csv", upsert: false,
  });
  if (error) redirect(`/admin/zoho?scan=${encodeURIComponent(`Upload failed: ${error.message}`)}#brokerage`);

  const { ingestActivityCsv } = await import("@/lib/brokerageWorkbook");
  let note: string;
  try {
    const r = await ingestActivityCsv({ account, from, to, fileRef: `secure:${path}`, fileName: file!.name });
    note = "error" in r
      ? `The note could not be prepared — ${r.error}`
      : `Working note prepared for ${account}, ${from} to ${to}.` +
        (r.note.partial ? " Some sales have no purchase cost in the file — they are listed for you." : "");
  } catch (e) { note = `The note could not be prepared — ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#brokerage`);
}

export async function rebuildBrokerageNoteAction(formData: FormData) {
  // WORK THE NOTE OUT AGAIN FROM THE FILE IT CAME FROM.
  //
  // The activity file is kept, so a note prepared before the desk started
  // recording its Rule 115 rates can be rebuilt rather than re-uploaded. Draft
  // only: a note he has approved has been journalled, and rebuilding it would
  // move figures that are already in the books.
  //
  // His own figure for uncosted sales is his, not the file's, so it is carried
  // across rather than thrown away.
  await assertArea("zoho");
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: n } = await svc.from("brokerage_notes")
    .select("account_name, period_start, period_end, status, source_url, workbook").eq("id", id).maybeSingle();
  if (!n) redirect(`/admin/zoho?scan=${encodeURIComponent("That working note could not be found.")}#brokerage`);
  if (n!.status !== "draft") {
    redirect(`/admin/zoho?scan=${encodeURIComponent("That note has already been approved and journalled — it is not rebuilt.")}#brokerage`);
  }
  if (!n!.source_url) {
    redirect(`/admin/zoho?scan=${encodeURIComponent("That note was summarised from statement lines, not from an activity file — upload the CSV to rebuild it.")}#brokerage`);
  }

  const keptCost = (n!.workbook as { equity?: { uncostedCost?: number | null } } | null)?.equity?.uncostedCost ?? null;
  const { ingestActivityCsv } = await import("@/lib/brokerageWorkbook");
  let note: string;
  try {
    const r = await ingestActivityCsv({
      account: String(n!.account_name), from: String(n!.period_start), to: String(n!.period_end),
      fileRef: String(n!.source_url), fileName: String(n!.source_url).split("/").pop() ?? "activity.csv",
    });
    if ("error" in r) note = `It could not be rebuilt — ${r.error}`;
    else {
      if (keptCost !== null) {
        const { data: fresh } = await svc.from("brokerage_notes").select("workbook").eq("id", r.id).maybeSingle();
        const wb = (fresh?.workbook ?? {}) as Record<string, unknown>;
        const equity = wb.equity as Record<string, number> | undefined;
        if (equity) {
          equity.uncostedCost = keptCost;
          equity.subTotal = Number(equity.realisedFifo) + (Number(equity.uncostedProceeds) - keptCost);
          wb.partial = false;
          wb.netResult = Number(equity.subTotal) + Number((wb.options as { net: number }).net)
            + Number((wb.income as { subTotal: number }).subTotal) + Number((wb.charges as { subTotal: number }).subTotal);
          await svc.from("brokerage_notes").update({ workbook: wb, note: null }).eq("id", r.id);
        }
      }
      // Read the count back off the saved row: the working note returned here is
      // the statement, and the rates are recorded alongside it, so asking the
      // note for them would always have answered none.
      const { data: saved } = await svc.from("brokerage_notes").select("workbook").eq("id", r.id).maybeSingle();
      const rates = ((saved?.workbook as { ratesUsed?: unknown[] } | null)?.ratesUsed ?? []).length;
      note = `Rebuilt from the activity file${rates ? ` — ${rates} Rule 115 rates recorded and shown` : ", but no exchange rate could be found for any of its dates"}.`;
    }
  } catch (e) { note = `It could not be rebuilt — ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#brokerage`);
}

export async function setUncostedCostAction(formData: FormData) {
  // His figure for shares the file has no purchase price for. Until it is here
  // the equity sub-total leaves those sales out entirely — proceeds without a
  // cost are not a gain.
  await assertArea("zoho");
  const noteId = str(formData.get("note_id"));
  const cost = Number(formData.get("cost"));
  if (!noteId || !(cost > 0)) return;
  const svc = createServiceClient();
  const { data: n } = await svc.from("brokerage_notes").select("workbook, status").eq("id", noteId).maybeSingle();
  if (!n || n.status !== "draft") return;

  const wb = n.workbook as Record<string, unknown>;
  const equity = wb.equity as Record<string, number>;
  equity.uncostedCost = cost;
  equity.subTotal = Number(equity.realisedFifo) + (Number(equity.uncostedProceeds) - cost);
  wb.partial = false;
  wb.netResult = Number(equity.subTotal) + Number((wb.options as { net: number }).net)
    + Number((wb.income as { subTotal: number }).subTotal) + Number((wb.charges as { subTotal: number }).subTotal);

  await svc.from("brokerage_notes").update({
    workbook: wb, note: null, updated_at: new Date().toISOString(),
  }).eq("id", noteId);
  revalidatePath("/admin/zoho");
}

export async function buildBrokerageNoteAction(formData: FormData) {
  // THE WORKING NOTE COMES FIRST. Nothing is journalled from a CSV directly.
  await assertArea("zoho");
  const account = str(formData.get("account_name"));
  const from = str(formData.get("from")) || `${new Date().getUTCFullYear()}-04-01`;
  const to = str(formData.get("to")) || new Date().toISOString().slice(0, 10);
  if (!account) return;
  const { saveNote } = await import("@/lib/brokerageNote");
  let note: string;
  try {
    const made = await saveNote(account, from, to);
    note = made ? `Working note prepared for ${account}, ${from} to ${to}.` : `Nothing found for ${account} between those dates.`;
  } catch (e) { note = `Could not prepare the note — ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#brokerage`);
}

export async function setSellCostAction(formData: FormData) {
  // What the shares sold originally cost. Without it a sale has proceeds and no
  // gain, and the note says so rather than assuming zero.
  await assertArea("zoho");
  const id = str(formData.get("id"));
  const costInr = Number(formData.get("cost_inr")) || 0;
  const noteId = str(formData.get("note_id"));
  if (!id || costInr <= 0) return;
  const svc = createServiceClient();
  await svc.from("brokerage_lines").update({ cost_inr: costInr, updated_at: new Date().toISOString() }).eq("id", id);

  // Rebuild the note so the gain moves with it.
  const { data: n } = await svc.from("brokerage_notes").select("account_name, period_start, period_end").eq("id", noteId).maybeSingle();
  if (n) {
    const { saveNote } = await import("@/lib/brokerageNote");
    try { await saveNote(String(n.account_name), String(n.period_start), String(n.period_end)); } catch { /* the figure is saved either way */ }
  }
  revalidatePath("/admin/zoho");
}

export async function approveBrokerageNoteAction(formData: FormData) {
  // The journal follows the note he approved — not the CSV.
  await assertArea("zoho");
  const me = await currentStaff();
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: n } = await svc.from("brokerage_notes").select("*").eq("id", id).maybeSingle();
  if (!n || n.status === "posted") return;

  // THE JOURNAL FOLLOWS THE NOTE, HEAD BY HEAD, IN RUPEES.
  //
  // Each head was converted at the Rule-115 rate of its own transactions when
  // the note was built, so the entry carries those figures rather than
  // re-converting a total at one rate.
  const wb = n.workbook as { partial?: boolean; inrByHead?: Record<string, number> } | null;

  let built: { lines: { account: string; side: "debit" | "credit"; amount: number; note: string; nature: string; operating: string }[]; narration: string };
  if (wb) {
    if (wb.partial) {
      redirect("/admin/zoho?scan=" + encodeURIComponent(
        "Those sales still have no purchase cost. Enter it first — a journal that leaves them out understates the gain, and one that includes the proceeds without the cost overstates it.",
      ) + "#brokerage");
    }
    // THE SAME BUILDER THE PAGE SHOWED HIM BEFORE HE PRESSED THIS.
    // He must never be able to approve one entry and have another one posted.
    const { journalFromWorkingNote } = await import("@/lib/brokerageJournal");
    built = journalFromWorkingNote({
      account_name: String(n.account_name), period_start: String(n.period_start),
      period_end: String(n.period_end), workbook: wb,
    });
  } else {
    const { journalFromNote } = await import("@/lib/brokerageNote");
    built = journalFromNote({
      account: String(n.account_name), from: String(n.period_start), to: String(n.period_end),
      buckets: n.buckets as never, gainInr: Number(n.gain_inr ?? 0), lossInr: Number(n.loss_inr ?? 0), unpricedSells: 0,
    }, String(n.account_name));
  }

  if (built.lines.length < 2) {
    redirect("/admin/zoho?scan=" + encodeURIComponent("There is nothing in that note to journal.") + "#brokerage");
  }

  const { data: doc } = await svc.from("zoho_documents").insert({
    kind: "journal", doc_date: n.period_end,
    // The broker's own file travels with the entry it justifies.
    file_url: n.source_url ?? null,
    file_name: `${n.account_name} ${n.period_start} to ${n.period_end}.csv`,
    description: built.narration,
    reference: `${n.account_name} ${n.period_start}..${n.period_end}`,
    amount: built.lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0),
    inr_amount: built.lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0),
    nature: "income", operating: "non_operating",
    journal_lines: built.lines, created_by: me?.id ?? null,
  }).select("id").single();
  if (!doc?.id) return;

  await svc.from("brokerage_notes").update({
    status: "approved", approved_by: me?.id ?? null, approved_at: new Date().toISOString(),
  }).eq("id", id);

  // Journalled through the gate like everything else.

  await requestApprovalFor("outgoing", "zoho_documents", String(doc.id), undefined, me?.id ?? null);
  revalidatePath("/admin/zoho");
  redirect("/admin/zoho?scan=" + encodeURIComponent("The journal from that note is with CA Parveen Sharma.") + "#brokerage");
}

export async function matchBankAction() {
  // Look at every waiting line and write down what it appears to settle.
  // Decides nothing, posts nothing.
  await assertArea("zoho");
  const { matchWaitingLines } = await import("@/lib/bankMatching");
  let note: string;
  try { note = await matchWaitingLines(); }
  catch (e) { note = `Could not read the open items from Zoho — ${e instanceof Error ? e.message : "unknown"}`; }
  revalidatePath("/admin/zoho");
  redirect(`/admin/zoho?scan=${encodeURIComponent(note)}#bank`);
}

export async function chooseMatchAction(formData: FormData) {
  // He picks which open document a payment settles, out of the ones it could be.
  await assertArea("zoho");
  const id = str(formData.get("id"));
  const docId = str(formData.get("doc_id"));
  if (!id) return;
  const svc = createServiceClient();

  if (docId === "__none") {
    // Not a settlement after all — it falls back to the ordinary treatment.
    await svc.from("bank_lines").update({
      match_kind: null, match_ids: null, match_label: null, match_confidence: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    revalidatePath("/admin/zoho");
    return;
  }

  const { data: l } = await svc.from("bank_lines").select("match_candidates").eq("id", id).maybeSingle();
  const cands = (l?.match_candidates ?? []) as { id: string; kind: string; number: string; party: string; balance: number }[];
  const pick = cands.find((c) => String(c.id) === docId);
  if (!pick) return;

  await svc.from("bank_lines").update({
    match_kind: pick.kind, match_ids: [pick.id], match_party: pick.party,
    match_label: `${pick.kind === "bill" ? "settles" : "receipt against"} ${pick.number || pick.kind} · ${pick.party} · ₹${Number(pick.balance).toLocaleString("en-IN")}`,
    match_confidence: "certain",
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/admin/zoho");
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
  const gst_rate = Number(formData.get("gst_rate")) || 18;
  const tds_rate = formData.get("tds_rate") === null || str(formData.get("tds_rate")) === ""
    ? null : Number(formData.get("tds_rate"));
  const tds_mode = str(formData.get("tds_mode")) || (tds_rate ? "deduct" : "none");
  const tds_section = str(formData.get("tds_section")) || (tds_rate ? "393(2) Sl.17" : null);
  const billDate = str(formData.get("bill_date")) || bill.bill_date;
  const amount = Number(formData.get("amount")) || Number(bill.amount);
  const rate = Number(formData.get("rate")) || Number(bill.rate) || null;
  const vendor_name = str(formData.get("vendor_name")) || String(bill.institution);
  const bill_no = str(formData.get("bill_no")) || bill.bill_no;
  // What the document IS — an expense, an asset, his own spending, income, a
  // liability, or a reversal of one of those.
  const nature = str(formData.get("nature")) || "expense";
  const operating = str(formData.get("operating")) || "operating";
  const sub_account = str(formData.get("sub_account")) || null;
  const supplier_kind = str(formData.get("supplier_kind")) || null;

  // A CHANGED ANSWER IS NOT A CHANGED FIGURE — it is a reason to work it out
  // again. Where he corrects the country or what the supplier actually did, the
  // withholding on the screen was computed from the OLD answer, so posting on it
  // would book a rate he never saw. The answers are saved, everything of theirs
  // still waiting is re-worked, and the line comes back for him to look at.
  const newCountry = str(formData.get("country"));
  const newCategory = str(formData.get("service_category"));
  if (newCountry || newCategory) {
    const { data: rule } = await svc.from("provider_bill_rules")
      .select("country, service_category").eq("institution", bill.institution).maybeSingle();
    const changed = (newCountry && newCountry !== rule?.country) ||
                    (newCategory && newCategory !== rule?.service_category);
    if (changed) {
      await svc.from("provider_bill_rules").update({
        ...(newCountry ? { country: newCountry } : {}),
        ...(newCategory ? { service_category: newCategory } : {}),
        answered_by: me?.id ?? null, answered_at: new Date().toISOString(),
      }).eq("institution", bill.institution);
      const { redetermineWaiting } = await import("@/lib/providerBills");
      let moved = 0;
      try { moved = await redetermineWaiting(String(bill.institution)); } catch { /* the rows keep what they had */ }
      revalidatePath("/admin/zoho");
      redirect("/admin/zoho?scan=" + encodeURIComponent(
        `${bill.institution} re-worked on the new answer${moved > 1 ? ` — all ${moved} of their invoices` : ""}. Check the line before posting.`,
      ) + "#bills");
    }
  }

  // THE TAX AS THE INVOICE PRINTS IT — kept as typed, never recomputed.
  const num = (k: string) => {
    const v = formData.get(k);
    if (v === null || String(v).trim() === "") return null;
    const n2 = Number(v);
    return Number.isFinite(n2) ? n2 : null;
  };
  const taxable_value = num("taxable_value");
  const cgst_amount = num("cgst_amount");
  const sgst_amount = num("sgst_amount");
  const igst_amount = num("igst_amount");

  const inrAmount = rate ? Number((amount * rate).toFixed(2)) : amount;
  const { tdsWorking } = await import("@/lib/postingShape");
  // TDS IS TAKEN ON THE TAXABLE VALUE WHERE WE KNOW IT.
  //
  // GST shown separately on an invoice is not part of the sum tax is deducted
  // on, so withholding on the tax-inclusive total over-deducts — FIRST FLY was
  // ₹70.53 against a correct ₹59.77. Where the invoice's taxable value has been
  // keyed it is the base; where it has not, the old behaviour stands and the
  // entry says on its face that the tax was derived rather than read.
  const tdsBase = taxable_value != null && taxable_value > 0 ? taxable_value : inrAmount;
  const work = tdsWorking(tdsBase, tds_mode as never, Number(tds_rate ?? 0), vendor_name);

  const proposal = {
    ...(bill.proposal as Record<string, unknown> ?? {}),
    vendor_name, expense_account, gst_treatment, gst_tax_name, gst_rate,
    tds_section, tds_rate, tds_mode, nature, operating, sub_account, supplier_kind,
  };

  await svc.from("provider_bills").update({
    bill_date: billDate, amount, bill_no,
    rate, inr_amount: inrAmount,
    nature, operating, sub_account, tds_mode,
    taxable_value, cgst_amount, sgst_amount, igst_amount,
    booked_amount: work.bookedAmount, tds_amount: work.tds, vendor_gets: work.vendorGets,
    proposal, status: "draft", error: null, updated_at: new Date().toISOString(),
  }).eq("id", id);

  // "When asked, that becomes a rule."
  if (str(formData.get("as_rule")) !== "no" && expense_account) {
    const { saveBillRule } = await import("@/lib/providerBills");
    try {
      await saveBillRule({
        institution: String(bill.institution), vendor_name, expense_account,
        gst_treatment, gst_rate, tds_section, tds_rate, gst_tax_name,
        nature, operating, sub_account, tds_mode, supplier_kind,
      });
    } catch { /* the entry still stands even if the rule could not be kept */ }
  }

  // IT ALWAYS ASKS, IT NEVER POSTS — including when he presses it himself.
  // His instruction, 25 Aug 2026: "it should not say approve and post to
  // Zoho, it should say send for approval". The architecture already said so
  // — the gate is "the only door, and it is yours alone" — and this was a
  // second door that posted on the spot, which is how an entry reaches the
  // books without him having sat and read it as an entry.

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
    status: "pending", created_by: staff?.id ?? null,
  }).select("id").single();
  if (!row) return;
  // THE FIFTH DOOR, AND THE QUIETEST. This posted the advance to Zoho on the
  // spot and swallowed the failure in an empty catch, so a rejected posting
  // looked exactly like nothing happening. It asks now, like everything else,
  // and the row waits as `pending` rather than being born `failed`.
  await requestApprovalFor("petty_advance", "petty_advances", String(row.id), undefined, staff?.id ?? null);
  revalidatePath("/admin/zoho");
  redirect("/admin/zoho?scan=" + encodeURIComponent("Advance recorded and sent to the approval gate.") + "#approvals");
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
