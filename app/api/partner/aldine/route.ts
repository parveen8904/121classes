import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { provisionPartnerPurchase } from "@/lib/partnerEnroll";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Purchases on aldine.edu.in (WooCommerce) land here and are provisioned on
// this site automatically.
//
// Authentication, either of:
//   - WooCommerce's own signature: X-WC-Webhook-Signature is the base64
//     HMAC-SHA256 of the raw body, keyed with the webhook "Secret" field —
//     which must equal ALDINE_WEBHOOK_SECRET (Admin → Integrations).
//   - ?key=<same secret> — for hand-testing with curl.
//
// Only PAID orders provision: status must be "processing" or "completed"
// (virtual/downloadable products auto-complete; either way money has been
// taken). Everything is recorded in partner_orders; the unique
// (source, order_ref, product_key) row is what makes webhook retries safe.

type WooLineItem = { product_id?: number | string; variation_id?: number | string; name?: string };
type WooOrder = {
  id?: number | string;
  status?: string;
  billing?: { email?: string; first_name?: string; last_name?: string; phone?: string };
  line_items?: WooLineItem[];
};

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  const secret = (await getSecret("ALDINE_WEBHOOK_SECRET")).trim();
  if (!secret) return NextResponse.json({ error: "bridge not configured" }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("x-wc-webhook-signature") ?? "";
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  const keyOk = new URL(req.url).searchParams.get("key") === secret;
  if (!keyOk && !(sig && safeEq(sig, expected))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // WooCommerce sends a bare ping when a webhook is first saved — answer it
  // politely or the webhook is marked as failed before it ever fires.
  let order: WooOrder;
  try {
    order = JSON.parse(raw) as WooOrder;
  } catch {
    return NextResponse.json({ ok: true, note: "ping" });
  }
  if (!order?.id || !order?.billing?.email) return NextResponse.json({ ok: true, note: "not an order payload" });

  const status = String(order.status ?? "").toLowerCase();
  if (!["processing", "completed"].includes(status)) {
    return NextResponse.json({ ok: true, note: `ignored status "${status}"` });
  }

  const svc = createServiceClient();
  const email = String(order.billing.email).trim().toLowerCase();
  const name = [order.billing.first_name, order.billing.last_name].filter(Boolean).join(" ").trim();
  const phone = String(order.billing.phone ?? "").trim();
  const orderRef = String(order.id);

  const { data: mappings } = await svc
    .from("partner_products")
    .select("product_key, course_id, subject_id, tier, months")
    .eq("source", "aldine")
    .eq("is_active", true);
  const map = new Map((mappings ?? []).map((m) => [String(m.product_key), m]));

  const results: Record<string, string> = {};
  for (const item of order.line_items ?? []) {
    const key = String(item.product_id ?? "");
    if (!key) continue;

    // The idempotency gate: first delivery inserts, a retry conflicts → skip.
    const { error: dupErr } = await svc.from("partner_orders").insert({
      source: "aldine", order_ref: orderRef, product_key: key,
      email, name, phone, status: "received",
    });
    if (dupErr) { results[key] = "already processed"; continue; }

    const m = map.get(key);
    if (!m) {
      await svc.from("partner_orders").update({ status: "unmapped", detail: item.name ?? null })
        .eq("source", "aldine").eq("order_ref", orderRef).eq("product_key", key);
      results[key] = "unmapped — set it up in Admin → Aldine bridge";
      continue;
    }

    const r = await provisionPartnerPurchase({
      email, name, phone,
      courseId: m.course_id as string,
      subjectId: (m.subject_id as string | null) ?? null,
      tier: String(m.tier), months: Number(m.months) || 12,
      source: "aldine",
    });
    await svc.from("partner_orders").update({
      status: r.ok ? "granted" : "error",
      detail: r.ok ? (r.alreadyHad ? "already had access" : (r.created ? "new account created" : "existing account")) : r.error,
      student_id: r.ok ? r.studentId : null,
    }).eq("source", "aldine").eq("order_ref", orderRef).eq("product_key", key);
    results[key] = r.ok ? "granted" : `error: ${r.error}`;
  }

  return NextResponse.json({ ok: true, order: orderRef, results });
}
