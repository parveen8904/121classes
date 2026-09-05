"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { buildReturn, loadYear, EMPTY_INPUTS, type YearInputs } from "@/lib/itrReturn";

// Everything here needs the books grant — the same one that opens the rest of
// the accounting hub, so Pradeep reaches it without the founder handing out
// anything new. Reading the books is not releasing money into them, so this
// deliberately does NOT need the approval grant.
const guard = () => assertArea("zoho");

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[, ₹]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Pull the year from Zoho, apply the mapping, keep the result for the page. */
export async function buildYearAction(fd: FormData) {
  await guard();
  const fy = String(fd.get("fy") || "").trim();
  if (!/^\d{4}-\d{2}$/.test(fy)) throw new Error("Pick a financial year like 2025-26.");

  // A BUILD THAT FAILS MUST SAY WHY, ON THE PAGE.
  //
  // "return builder is not working" — 5 September 2026. It reads two Zoho
  // reports for the year, and when either refuses this threw: a server action
  // that throws gives back an unexplained error and the page comes back looking
  // exactly as it did, with 2025-26 still unbuilt. Nothing on screen said which
  // year, which report, or what Zoho answered — so "not working" was all there
  // was to report.
  let pack: Awaited<ReturnType<typeof buildReturn>> | null = null;
  try {
    pack = await buildReturn(fy);
  } catch (e) {
    const why = e instanceof Error ? e.message : "Zoho did not answer.";
    redirect(`/admin/zoho/itr?fy=${encodeURIComponent(fy)}&err=${encodeURIComponent(`${fy} could not be built: ${why}`)}`);
  }
  const staff = await currentStaff();
  const svc = createServiceClient();
  await svc.from("itr_years").upsert(
    { fy, snapshot: pack, built_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: staff?.id ?? null },
    { onConflict: "fy" },
  );
  revalidatePath("/admin/zoho/itr");
  redirect(`/admin/zoho/itr?fy=${encodeURIComponent(fy)}&built=1`);
}

/** Move one ledger to a different destination. All three outputs follow. */
export async function setBucketAction(fd: FormData) {
  await guard();
  const ledger = String(fd.get("ledger") || "").trim();
  const kind = String(fd.get("kind") || "");
  const bucket = String(fd.get("bucket") || "").trim();
  if (!ledger || (kind !== "pl" && kind !== "bs") || !bucket) throw new Error("Nothing to change.");
  const staff = await currentStaff();
  const svc = createServiceClient();
  await svc.from("itr_ledger_map").upsert(
    { ledger, kind, bucket, updated_at: new Date().toISOString(), updated_by: staff?.id ?? null },
    { onConflict: "ledger" },
  );
  revalidatePath("/admin/zoho/itr");
}

/**
 * Drop every change the desk has made and fall back to the suggested mapping —
 * the one reconciled against the FY 2025-26 audited statements, which lives in
 * code. Nothing is lost that was not deliberately typed here.
 */
export async function restoreSuggestedMapAction() {
  await guard();
  const svc = createServiceClient();
  const { error } = await svc.from("itr_ledger_map").delete().neq("ledger", "");
  if (error) throw new Error(`The mapping could not be reset: ${error.message}`);
  revalidatePath("/admin/zoho/itr");
}

/** The figures that are not in Zoho: opening capital, b/f losses, and so on. */
export async function saveInputsAction(fd: FormData) {
  await guard();
  const fy = String(fd.get("fy") || "").trim();
  if (!/^\d{4}-\d{2}$/.test(fy)) throw new Error("Pick a financial year like 2025-26.");
  const { inputs } = await loadYear(fy);

  // Per-property lines arrive as hp:<ledger>:<field>; a rent ledger the books
  // hold at his share only needs all three to make sense of it.
  const share: Record<string, number> = { ...inputs.hpOwnershipShare };
  const gross: Record<string, number> = { ...inputs.hpGrossUp };
  const mtax: Record<string, number> = { ...inputs.hpMunicipalTax };
  const usd: Record<string, number> = { ...inputs.usdBalances };
  for (const [k, v] of fd.entries()) {
    const m = /^(hpShare|hpGross|hpTax|usd):(.+)$/.exec(k);
    if (!m) continue;
    const ledger = m[2];
    const val = num(v);
    if (m[1] === "hpShare") { if (val > 0) share[ledger] = val; else delete share[ledger]; }
    if (m[1] === "hpGross") { if (val) gross[ledger] = val; else delete gross[ledger]; }
    if (m[1] === "hpTax") { if (val) mtax[ledger] = val; else delete mtax[ledger]; }
    if (m[1] === "usd") { if (String(v).trim() !== "") usd[ledger] = val; else delete usd[ledger]; }
  }

  const next: YearInputs = {
    ...EMPTY_INPUTS,
    openingCapital: num(fd.get("openingCapital")),
    capitalIntroduced: num(fd.get("capitalIntroduced")),
    auditFeeProvision: num(fd.get("auditFeeProvision")),
    depreciationPerItChart: num(fd.get("depreciationPerItChart")),
    broughtForwardStcl: num(fd.get("broughtForwardStcl")),
    broughtForwardLtcl: num(fd.get("broughtForwardLtcl")),
    closingUsdRate: num(fd.get("closingUsdRate")),
    hpOwnershipShare: share, hpGrossUp: gross, hpMunicipalTax: mtax, usdBalances: usd,
    notes: String(fd.get("notes") || "").slice(0, 4000),
  };
  const staff = await currentStaff();
  const svc = createServiceClient();
  await svc.from("itr_years").upsert(
    { fy, inputs: next, updated_at: new Date().toISOString(), updated_by: staff?.id ?? null },
    { onConflict: "fy" },
  );
  // The saved figures change the answer, so rebuild rather than leave a stale
  // snapshot on screen looking authoritative.
  await buildYearAction(fd);
}
