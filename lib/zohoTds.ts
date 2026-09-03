import { zohoFetch } from "@/lib/zohoApi";
import { createServiceClient } from "@/lib/supabase/service";

// THE TDS MASTER IN ZOHO.
//
// FIRST FLY posted on 26 Aug 2026 with its GST right and its withholding
// missing: "TDS 393(2) Sl.17 @ 1% must be applied by hand — no matching TDS
// tax in Zoho." The bill was correct; his books simply had no TDS rate to
// point at, so the ₹60 never attached.
//
// He asked for the setup to be done automatically. One honest caveat, checked
// against Zoho's published API rather than assumed: the documented create-tax
// endpoint takes tax_specific_type of igst, cgst, sgst, nil or cess — TDS is
// not among them, and Zoho documents TDS as a Settings screen. So this ASKS
// Zoho to create it and reports exactly what Zoho says. If the org refuses,
// the answer appears on screen instead of a rate silently going missing again.

export type { TdsTax } from "@/lib/tdsMatch";
import type { TdsTax } from "@/lib/tdsMatch";

/**
 * Every TDS rate the organisation holds.
 *
 * `filter_by=Taxes.Tds` came back EMPTY on his org while a 1% TDS demonstrably
 * exists in it — which is precisely how a bill came to post reporting "no
 * matching TDS tax". Trusting one filter constant to be the whole truth is the
 * same error as trusting a failed lookup to mean "none".
 *
 * So it asks the filtered way first and, when that yields nothing, reads the
 * whole tax list and keeps what is actually a TDS rate — Zoho marks it on the
 * record (tax_type / tax_specific_type), and failing that the name says so.
 */
import type { RawTax } from "@/lib/tdsMatch";

const looksTds = (t: RawTax) =>
  /tds/i.test(String(t.tax_type ?? "")) ||
  /tds/i.test(String(t.tax_specific_type ?? "")) ||
  /\btds\b/i.test(String(t.tax_name ?? ""));

export async function listZohoTds(): Promise<TdsTax[]> {
  // THE PARAMETER THAT ACTUALLY SWITCHES THE LIST — is_tds_request=true.
  //
  // Taken from Zoho's own web app: opening Settings → Taxes & Compliance →
  // Direct Taxes → Income TDS Rates issues
  //   /settings/taxes?filter_by=Taxes.All&is_tds_request=true
  // Without that flag the SAME endpoint returns the GST rates instead, which
  // is why we read six GST rates and concluded there were no TDS rates at all,
  // and why FIRST FLY posted saying "no matching TDS tax in Zoho" while his
  // books held a whole TDS master. filter_by=Taxes.Tds is not the switch.
  const tds = await zohoFetch<{ taxes?: RawTax[] }>(
    "/settings/taxes", { query: { filter_by: "Taxes.All", is_tds_request: "true", per_page: "200" } },
  ).catch(() => null);
  if (tds?.taxes?.length) return tds.taxes;

  // Belt and braces, in case an org answers differently.
  const all = await zohoFetch<{ taxes?: RawTax[] }>("/settings/taxes").catch(() => null);
  return (all?.taxes ?? []).filter(looksTds);
}

/** Everything Zoho returns, TDS or not — for the screen, when nothing matches. */
export async function listAllZohoTaxes(): Promise<RawTax[]> {
  const all = await zohoFetch<{ taxes?: RawTax[] }>("/settings/taxes").catch(() => null);
  return all?.taxes ?? [];
}

/** Which sections our own vendor rules will need when their bills post. */
export async function tdsSectionsNeeded(): Promise<{ section: string; rate: number; vendors: string[] }[]> {
  const { data } = await createServiceClient()
    .from("provider_bill_rules")
    .select("institution, tds_section, tds_rate")
    .not("tds_section", "is", null);

  const byKey = new Map<string, { section: string; rate: number; vendors: string[] }>();
  for (const r of data ?? []) {
    const section = String((r as { tds_section: string }).tds_section ?? "").trim();
    const rate = Number((r as { tds_rate: number | null }).tds_rate ?? 0);
    if (!section || !(rate > 0)) continue;
    const key = `${section}|${rate}`;
    const row = byKey.get(key) ?? { section, rate, vendors: [] };
    row.vendors.push(String((r as { institution: string }).institution));
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

export { matchTds } from "@/lib/tdsMatch";
import { matchTds } from "@/lib/tdsMatch";

/**
 * Ask Zoho to create one TDS rate.
 *
 * Returns Zoho's own words on failure. Nothing is retried and nothing is
 * guessed twice: a tax master is his accounting record, and a wrong one is
 * worse than a missing one.
 */
export async function createZohoTds(section: string, rate: number): Promise<{ ok: boolean; why: string }> {
  const name = `TDS ${section} ${rate}%`;
  const existing = matchTds(await listZohoTds(), section, rate);
  if (existing) return { ok: true, why: `Zoho already holds "${existing.tax_name}".` };

  try {
    const r = await zohoFetch<{ tax?: { tax_id: string; tax_name: string } }>("/settings/taxes", {
      method: "POST",
      body: {
        tax_name: name,
        tax_percentage: rate,
        tax_type: "tds",
        is_value_added: false,
      },
    });
    if (r?.tax?.tax_id) return { ok: true, why: `Created "${r.tax.tax_name}" in Zoho.` };
    return { ok: false, why: "Zoho accepted the request but returned no tax." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return {
      ok: false,
      why:
        `Zoho would not create it: ${msg}. TDS rates may have to be added on the Zoho screen — ` +
        `Settings → Taxes → TDS → New — as "${name}" at ${rate}%. Once it exists, bills carrying ` +
        `${section} will pick it up on their own.`,
    };
  }
}
