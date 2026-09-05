"use server";

import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { INPUT_KEYS, statuteFor, statutoryFigures } from "@/lib/us1040";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/** Save one figure. One row, one press — see the standing rule on editors. */
export async function setUs1040Input(fd: FormData) {
  await assertArea("zoho");
  const year = Math.round(Number(fd.get("year")));
  const key = String(fd.get("key") || "");
  const raw = String(fd.get("value") ?? "").trim();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return;
  if (!INPUT_KEYS.some((k) => k.key === key)) return;
  const value = Number(raw.replace(/[,$\s]/g, ""));
  if (!Number.isFinite(value)) {
    redirect(`/admin/zoho/tax/us1040?year=${year}&err=${encodeURIComponent(`"${raw}" is not a number.`)}`);
  }
  const staff = await currentStaff();
  await createServiceClient().from("us1040_inputs").upsert(
    { year, key, value, updated_at: new Date().toISOString(), updated_by: staff?.id ?? null },
    { onConflict: "year,key" },
  );
  revalidatePath("/admin/zoho/tax/us1040");
  redirect(`/admin/zoho/tax/us1040?year=${year}&saved=${encodeURIComponent(key)}`);
}

/**
 * Open a year with the law in it rather than with zeros.
 *
 * A blank sheet computes a tax of nothing on everything, which looks like an
 * answer. The statutory figures are the ones nobody should have to look up
 * twice, so a new year starts holding them and he changes what the year
 * changed.
 */
export async function seedUs1040Year(fd: FormData) {
  await assertArea("zoho");
  const year = Math.round(Number(fd.get("year")));
  if (!Number.isFinite(year)) return;
  // THAT YEAR'S LAW, OR NOTHING. Seeding 2024 with the 2025 statute was how
  // "2024 not working" came about: the rows arrived, the banner went quiet, and
  // the return was computed on the wrong year's deduction and wage base.
  const statute = statuteFor(year);
  const figures = statutoryFigures(year);
  if (!statute || !figures) {
    redirect(`/admin/zoho/tax/us1040?year=${year}&err=${encodeURIComponent(
      `The 1040 does not hold the statute for ${year}, and another year's law would give a wrong return that looks right.`,
    )}`);
  }
  const staff = await currentStaff();
  const rows = Object.entries(figures).map(([key, value]) => ({
    year, key, value: Number(value),
    note: `${year} statute — ${statute.citation}`,
    updated_at: new Date().toISOString(), updated_by: staff?.id ?? null,
  }));
  await createServiceClient().from("us1040_inputs").upsert(rows, { onConflict: "year,key" });
  revalidatePath("/admin/zoho/tax/us1040");
  redirect(`/admin/zoho/tax/us1040?year=${year}&seeded=1`);
}
