import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

// TEMPORARY PROBE — asks each provider's API what it will actually give us for
// billing, so the monthly fetcher is built on fact rather than assumption.
// Founder-gated; returns SHAPES and status codes only, never key material.
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return new NextResponse("Not available", { status: 404 });

  const out: Record<string, unknown> = {};

  // ---- Bunny: AccessKey header, /billing ----
  try {
    const key = await getSecret("BUNNY_ACCOUNT_API_KEY");
    if (!key) out.bunny = { configured: false };
    else {
      const r = await fetch("https://api.bunny.net/billing", {
        headers: { AccessKey: key, accept: "application/json" }, cache: "no-store",
      });
      const body = await r.text();
      let shape: unknown = body.slice(0, 400);
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const recs = (j.BillingRecords ?? j.billingRecords) as unknown[] | undefined;
        shape = {
          topLevelKeys: Object.keys(j).slice(0, 20),
          recordCount: Array.isArray(recs) ? recs.length : null,
          sampleRecordKeys: Array.isArray(recs) && recs[0] ? Object.keys(recs[0] as object) : null,
          sampleRecord: Array.isArray(recs) && recs[0] ? recs[0] : null,
        };
      } catch { /* keep raw slice */ }
      out.bunny = { configured: true, status: r.status, shape };
    }
  } catch (e) { out.bunny = { error: e instanceof Error ? e.message : "failed" }; }

  // ---- Anthropic: Admin API (cost report) needs an ADMIN key (sk-ant-admin…) ----
  try {
    const key = await getSecret("ANTHROPIC_ADMIN_KEY");
    const fallback = await getSecret("ANTHROPIC_API_KEY");
    const use = key || fallback;
    out.anthropicKeyKind = key ? "admin key present" : fallback ? "only a normal API key is stored" : "none";
    if (use) {
      const r = await fetch("https://api.anthropic.com/v1/organizations/cost_report?starting_at=2026-06-01T00:00:00Z&limit=1", {
        headers: { "x-api-key": use, "anthropic-version": "2023-06-01" }, cache: "no-store",
      });
      out.anthropic = { status: r.status, body: (await r.text()).slice(0, 300) };
    }
  } catch (e) { out.anthropic = { error: e instanceof Error ? e.message : "failed" }; }

  // ---- Mailgun: is there anything billing-shaped on the public API? ----
  try {
    const key = await getSecret("MAILGUN_API_KEY");
    if (!key) out.mailgun = { configured: false };
    else {
      const auth = `Basic ${Buffer.from(`api:${key}`).toString("base64")}`;
      const probes: Record<string, number> = {};
      for (const path of ["/v5/accounts/subscription", "/v1/accounts/billing", "/v3/billing/invoices"]) {
        try {
          const r = await fetch(`https://api.mailgun.net${path}`, { headers: { Authorization: auth }, cache: "no-store" });
          probes[path] = r.status;
        } catch { probes[path] = -1; }
      }
      out.mailgun = { configured: true, probes };
    }
  } catch (e) { out.mailgun = { error: e instanceof Error ? e.message : "failed" }; }

  return NextResponse.json(out);
}
