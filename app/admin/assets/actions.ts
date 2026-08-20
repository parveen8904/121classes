"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { assetViewer, BUCKET, generateOccurrences, handledAssetIds, istToday } from "@/lib/assets";

// Every write on the assets desk. Each action re-resolves the caller's role —
// the founder decided who may do what, and a form is not a permission.
//
//   admin    → everything
//   handler  → record transactions / complete tasks / act on letters,
//             but ONLY on assets assigned to them
//   accounts → verify or query transactions

const str = (v: FormData, k: string) => String(v.get(k) ?? "").trim();
const num = (v: FormData, k: string): number | null => {
  const n = Number(String(v.get(k) ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) && String(v.get(k) ?? "").trim() !== "" ? n : null;
};
const dateOrNull = (v: FormData, k: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(str(v, k)) ? str(v, k) : null;

async function admin() {
  const v = await assetViewer();
  if (!v || v.role !== "admin") throw new Error("Only the founder may do this.");
  return v;
}

/** handler on THIS asset, or accounts, or admin — for recording work. */
async function mayWork(assetId: string) {
  const v = await assetViewer();
  if (!v) throw new Error("Not authorised.");
  if (v.role === "handler") {
    const ids = await handledAssetIds(v.staff.id);
    if (!ids.includes(assetId)) throw new Error("This asset is not assigned to you.");
  }
  return v;
}

async function putFile(file: unknown, prefix: string): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 15_000_000) throw new Error("File too large (15 MB limit).");
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${prefix}/${Date.now()}-${safe}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await createServiceClient().storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

// ── Assets ───────────────────────────────────────────────────────────────────

export async function createAsset(formData: FormData): Promise<void> {
  await admin();
  const name = str(formData, "name");
  if (!name) redirect("/admin/assets?err=name");
  const { data } = await createServiceClient().from("assets").insert({
    name,
    type: str(formData, "type") || "property",
    address: str(formData, "address") || null,
    invested_on: dateOrNull(formData, "invested_on"),
    matures_on: dateOrNull(formData, "matures_on"),
    invested_amount: num(formData, "invested_amount"),
    contractual_return: num(formData, "contractual_return"),
    notes: str(formData, "notes") || null,
  }).select("id").maybeSingle();
  redirect(data?.id ? `/admin/assets/${data.id}` : "/admin/assets");
}

export async function updateAsset(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id");
  await createServiceClient().from("assets").update({
    name: str(formData, "name") || undefined,
    type: str(formData, "type") || undefined,
    address: str(formData, "address") || null,
    invested_on: dateOrNull(formData, "invested_on"),
    matures_on: dateOrNull(formData, "matures_on"),
    invested_amount: num(formData, "invested_amount"),
    contractual_return: num(formData, "contractual_return"),
    current_value: num(formData, "current_value"),
    current_value_on: dateOrNull(formData, "current_value_on"),
    notes: str(formData, "notes") || null,
  }).eq("id", id);
  revalidatePath(`/admin/assets/${id}`);
}

export async function closeAsset(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id");
  const kind = str(formData, "closed_kind");
  const closedOn = dateOrNull(formData, "closed_on");
  const amount = num(formData, "sale_amount");
  if (!id || !["maturity", "sale", "settlement"].includes(kind) || !closedOn) return;
  const svc = createServiceClient();
  await svc.from("assets").update({
    status: "closed", closed_kind: kind, closed_on: closedOn,
    sold_to: str(formData, "sold_to") || null, sale_amount: amount,
  }).eq("id", id);
  // The proceeds are money like any other money: a ledger row, unverified,
  // for accounts to tick. The XIRR terminal comes from the asset row itself.
  if (amount) {
    const v = await assetViewer();
    await svc.from("asset_txns").insert({
      asset_id: id, on_date: closedOn,
      nature: kind === "sale" ? "Sale proceeds" : "Maturity proceeds",
      direction: "in", amount, entered_by: v?.staff.id ?? null,
      note: str(formData, "sold_to") ? `From ${str(formData, "sold_to")}` : null,
    });
  }
  // Standing orders die with the asset; history stays.
  await svc.from("asset_tasks").update({ active: false }).eq("asset_id", id);
  await svc.from("asset_occurrences").update({ status: "skipped" }).eq("asset_id", id).eq("status", "pending");
  revalidatePath(`/admin/assets/${id}`);
}

// ── Owners & handlers (founder only) ─────────────────────────────────────────

export async function addOwner(formData: FormData): Promise<void> {
  await admin();
  const assetId = str(formData, "asset_id");
  const name = str(formData, "owner_name");
  const pct = num(formData, "share_pct");
  if (!assetId || !name || pct == null || pct <= 0 || pct > 100) return;
  await createServiceClient().from("asset_owners").insert({ asset_id: assetId, owner_name: name, share_pct: pct });
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function removeOwner(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id"), assetId = str(formData, "asset_id");
  await createServiceClient().from("asset_owners").delete().eq("id", id);
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function setHandler(formData: FormData): Promise<void> {
  await admin();
  const assetId = str(formData, "asset_id"), userId = str(formData, "user_id");
  const on = str(formData, "on") === "1";
  if (!assetId || !userId) return;
  const svc = createServiceClient();
  if (on) await svc.from("asset_handlers").upsert({ asset_id: assetId, user_id: userId });
  else await svc.from("asset_handlers").delete().eq("asset_id", assetId).eq("user_id", userId);
  revalidatePath(`/admin/assets/${assetId}`);
}

// ── Files ────────────────────────────────────────────────────────────────────

export async function uploadAssetFile(formData: FormData): Promise<void> {
  const assetId = str(formData, "asset_id");
  const v = await mayWork(assetId);
  const kind = str(formData, "kind") === "photo" ? "photo" : "document";
  const path = await putFile(formData.get("file"), `${assetId}/${kind}s`);
  if (!path) redirect(`/admin/assets/${assetId}?err=nofile`);
  await createServiceClient().from("asset_docs").insert({
    asset_id: assetId, kind, path,
    title: str(formData, "title") || null, uploaded_by: v.staff.id,
  });
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function deleteAssetFile(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id"), assetId = str(formData, "asset_id");
  const svc = createServiceClient();
  const { data } = await svc.from("asset_docs").select("path").eq("id", id).maybeSingle();
  if (data?.path) await svc.storage.from(BUCKET).remove([String(data.path)]);
  await svc.from("asset_docs").delete().eq("id", id);
  revalidatePath(`/admin/assets/${assetId}`);
}

// ── Tenancy ──────────────────────────────────────────────────────────────────

export async function saveTenancy(formData: FormData): Promise<void> {
  await admin();
  const assetId = str(formData, "asset_id");
  if (!assetId) return;
  const svc = createServiceClient();
  const agreement = await putFile(formData.get("agreement"), `${assetId}/agreements`).catch(() => null);
  const { data: existing } = await svc.from("asset_tenancy").select("agreement_path").eq("asset_id", assetId).maybeSingle();
  const rent = num(formData, "monthly_rent");
  const dueDay = Math.min(28, Math.max(1, num(formData, "rent_due_day") ?? 5));
  await svc.from("asset_tenancy").upsert({
    asset_id: assetId,
    tenant_name: str(formData, "tenant_name") || null,
    agreement_date: dateOrNull(formData, "agreement_date"),
    agreement_expiry: dateOrNull(formData, "agreement_expiry"),
    agreement_path: agreement || existing?.agreement_path || null,
    monthly_rent: rent,
    rent_due_day: dueDay,
    expiry_warned_at: null, // a fresh agreement resets the 60-day warning
  });

  // The tenancy IS a standing order: keep exactly one auto rent task in step
  // with it, so nobody maintains the same fact twice.
  const { data: task } = await svc.from("asset_tasks")
    .select("id").eq("asset_id", assetId).eq("from_tenancy", true).maybeSingle();
  const taskRow = {
    asset_id: assetId, title: "Rent collection", nature: "Rent received",
    direction: "in", cadence: "monthly", due_day: dueDay,
    expected_amount: rent, from_tenancy: true, active: Boolean(rent),
  };
  if (task?.id) await svc.from("asset_tasks").update(taskRow).eq("id", task.id);
  else if (rent) await svc.from("asset_tasks").insert(taskRow);
  await generateOccurrences();
  revalidatePath(`/admin/assets/${assetId}`);
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export async function addTask(formData: FormData): Promise<void> {
  await admin();
  const assetId = str(formData, "asset_id");
  const title = str(formData, "title");
  const cadence = ["monthly", "annual", "once"].includes(str(formData, "cadence")) ? str(formData, "cadence") : "monthly";
  if (!assetId || !title) return;
  await createServiceClient().from("asset_tasks").insert({
    asset_id: assetId, title,
    nature: str(formData, "nature") || title,
    direction: str(formData, "direction") === "out" ? "out" : "in",
    cadence,
    due_day: cadence === "monthly" ? Math.min(28, Math.max(1, num(formData, "due_day") ?? 5)) : null,
    // A once/annual task WITHOUT a date used to save fine and then never
    // become an occurrence — invisible on every work list (the founder's
    // "seepage" task, day one). No date now means due today.
    anchor_date: cadence !== "monthly" ? (dateOrNull(formData, "anchor_date") ?? istToday()) : null,
    expected_amount: num(formData, "expected_amount"),
    assigned_to: str(formData, "assigned_to") || null,
  });
  await generateOccurrences();
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function setTaskAssignee(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id"), assetId = str(formData, "asset_id");
  await createServiceClient().from("asset_tasks")
    .update({ assigned_to: str(formData, "assigned_to") || null }).eq("id", id);
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function toggleTask(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id"), assetId = str(formData, "asset_id");
  const { data } = await createServiceClient().from("asset_tasks").select("active").eq("id", id).maybeSingle();
  await createServiceClient().from("asset_tasks").update({ active: !data?.active }).eq("id", id);
  revalidatePath(`/admin/assets/${assetId}`);
}

// ── Transactions ─────────────────────────────────────────────────────────────

/**
 * Record money — standalone, or as the completion of a task occurrence.
 * One form, one record: the founder's "the task's completion is the
 * transaction", verbatim.
 */
export async function addTxn(formData: FormData): Promise<void> {
  const assetId = str(formData, "asset_id");
  const v = await mayWork(assetId);
  const amount = num(formData, "amount");
  const onDate = dateOrNull(formData, "on_date");
  const back = str(formData, "back") || `/admin/assets/${assetId}`;
  if (!assetId || amount == null || amount <= 0 || !onDate) redirect(`${back}?err=txn`);

  const docPath = await putFile(formData.get("file"), `${assetId}/txns`).catch(() => null);
  const occurrenceId = str(formData, "occurrence_id") || null;

  const svc = createServiceClient();
  const { data: txn } = await svc.from("asset_txns").insert({
    asset_id: assetId, occurrence_id: occurrenceId,
    on_date: onDate,
    nature: str(formData, "nature") || "Other income",
    direction: str(formData, "direction") === "out" ? "out" : "in",
    amount, gst: num(formData, "gst") ?? 0, tds: num(formData, "tds") ?? 0,
    doc_path: docPath, note: str(formData, "note") || null,
    entered_by: v.staff.id,
  }).select("id").maybeSingle();

  if (occurrenceId && txn?.id) {
    await svc.from("asset_occurrences").update({
      status: "done", txn_id: txn.id, completed_at: new Date().toISOString(),
    }).eq("id", occurrenceId);
  }
  revalidatePath(back);
  redirect(back);
}

export async function verifyTxn(formData: FormData): Promise<void> {
  const v = await assetViewer();
  if (!v || (v.role !== "admin" && v.role !== "accounts")) throw new Error("Accounts only.");
  const id = str(formData, "id");
  const back = str(formData, "back") || "/admin/assets/accounts";
  await createServiceClient().from("asset_txns").update({
    verified_at: new Date().toISOString(), verified_by: v.staff.id, accounts_query: null,
  }).eq("id", id);
  revalidatePath(back);
}

export async function queryTxn(formData: FormData): Promise<void> {
  const v = await assetViewer();
  if (!v || (v.role !== "admin" && v.role !== "accounts")) throw new Error("Accounts only.");
  const id = str(formData, "id");
  const back = str(formData, "back") || "/admin/assets/accounts";
  const q = str(formData, "query");
  if (!q) return;
  await createServiceClient().from("asset_txns").update({ accounts_query: q.slice(0, 500) }).eq("id", id);
  revalidatePath(back);
}

// ── Letters ──────────────────────────────────────────────────────────────────

export async function addLetter(formData: FormData): Promise<void> {
  const assetId = str(formData, "asset_id");
  const v = await mayWork(assetId);
  const title = str(formData, "title");
  if (!title) return;
  const path = await putFile(formData.get("file"), `${assetId}/letters`).catch(() => null);
  await createServiceClient().from("asset_letters").insert({
    asset_id: assetId, title,
    received_on: dateOrNull(formData, "received_on"),
    file_path: path,
    action_plan: str(formData, "action_plan") || null,
    assigned_to: str(formData, "assigned_to") || v.staff.id,
    due_on: dateOrNull(formData, "due_on"),
  });
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function closeLetter(formData: FormData): Promise<void> {
  const assetId = str(formData, "asset_id");
  await mayWork(assetId);
  const id = str(formData, "id");
  const back = str(formData, "back") || `/admin/assets/${assetId}`;
  await createServiceClient().from("asset_letters").update({
    status: "closed", closed_at: new Date().toISOString(),
    closed_note: str(formData, "closed_note") || null,
  }).eq("id", id);
  revalidatePath(back);
}

// ── Edits (founder's ask, 20 Aug evening: everything must be editable) ──────

/** Rewrite a standing task. Future pending occurrences are re-dated. */
export async function editTask(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id"), assetId = str(formData, "asset_id");
  if (!id) return;
  const cadence = ["monthly", "annual", "once"].includes(str(formData, "cadence")) ? str(formData, "cadence") : "monthly";
  const svc = createServiceClient();
  await svc.from("asset_tasks").update({
    title: str(formData, "title") || undefined,
    nature: str(formData, "nature") || undefined,
    direction: str(formData, "direction") === "out" ? "out" : "in",
    cadence,
    due_day: cadence === "monthly" ? Math.min(28, Math.max(1, num(formData, "due_day") ?? 5)) : null,
    anchor_date: cadence !== "monthly" ? (dateOrNull(formData, "anchor_date") ?? istToday()) : null,
    expected_amount: num(formData, "expected_amount"),
    assigned_to: str(formData, "assigned_to") || null,
  }).eq("id", id);
  // The schedule changed, so the dated copies not yet worked are wrong:
  // drop the untouched pending ones and regenerate from the new rhythm.
  await svc.from("asset_occurrences").delete().eq("task_id", id).eq("status", "pending").is("txn_id", null);
  await generateOccurrences();
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function updateOwner(formData: FormData): Promise<void> {
  await admin();
  const id = str(formData, "id"), assetId = str(formData, "asset_id");
  const name = str(formData, "owner_name");
  const pct = num(formData, "share_pct");
  if (!id || !name || pct == null || pct <= 0 || pct > 100) return;
  await createServiceClient().from("asset_owners").update({ owner_name: name, share_pct: pct }).eq("id", id);
  revalidatePath(`/admin/assets/${assetId}`);
}

export async function editLetter(formData: FormData): Promise<void> {
  const assetId = str(formData, "asset_id");
  await mayWork(assetId);
  const id = str(formData, "id");
  if (!id) return;
  await createServiceClient().from("asset_letters").update({
    title: str(formData, "title") || undefined,
    received_on: dateOrNull(formData, "received_on"),
    due_on: dateOrNull(formData, "due_on"),
    action_plan: str(formData, "action_plan") || null,
    assigned_to: str(formData, "assigned_to") || null,
  }).eq("id", id);
  revalidatePath(`/admin/assets/${assetId}`);
}
