import crypto from "crypto";
import { getSecret } from "@/lib/secrets";

// Razorpay integration. All functions here are SERVER-ONLY (they use the secret
// key). Keys come from Vercel env OR the admin-managed secret store, so the
// helpers are async. The site works without keys — razorpayConfigured() is false
// and the UI falls back to "contact us / coming soon".

export async function razorpayConfigured(): Promise<boolean> {
  return Boolean((await getSecret("RAZORPAY_KEY_ID")) && (await getSecret("RAZORPAY_KEY_SECRET")));
}

// Public key id (safe to expose to the browser checkout widget).
export async function razorpayKeyId(): Promise<string> {
  return (await getSecret("RAZORPAY_KEY_ID")) || "";
}

async function authHeader(): Promise<string> {
  const id = await getSecret("RAZORPAY_KEY_ID");
  const secret = await getSecret("RAZORPAY_KEY_SECRET");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  notes: Record<string, string>;
};

export async function createRazorpayOrder(
  amountInr: number,
  receipt: string,
  notes: Record<string, string>,
): Promise<RazorpayOrder> {
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(amountInr * 100), currency: "INR", receipt, notes }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Razorpay create order failed: ${res.status}`);
  return res.json();
}

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrder> {
  const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    headers: { Authorization: await authHeader() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Razorpay fetch order failed: ${res.status}`);
  return res.json();
}

// EVERY captured payment on the Razorpay account — including payment links,
// QR/UPI collections and anything taken OUTSIDE the website checkout. This is
// the source of truth for the admin Sales report (the site's own tables only
// know website-checkout sales).
export type RazorpayPayment = {
  id: string; amount: number; currency: string; status: string; method: string;
  email: string | null; contact: string | null; description: string | null;
  created_at: number; notes: Record<string, string> | null; fee: number | null; order_id: string | null;
};

// Returns whether it stopped early, because a silent cap is how the founder
// ended up believing 90 days held exactly 500 payments. 5,000 is 50 API pages;
// beyond that, or past the time budget, he is told rather than shorted.
export type RazorpayList = { payments: RazorpayPayment[]; truncated: boolean };

export async function listRazorpayPayments(
  days = 90,
  max = 5000,
  // Optional custom range (IST calendar dates, YYYY-MM-DD) — overrides `days`.
  range?: { from?: string | null; to?: string | null },
): Promise<RazorpayList> {
  let from = Math.floor(Date.now() / 1000) - days * 86400;
  let to: number | null = null;
  if (range?.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from)) {
    from = Math.floor(new Date(`${range.from}T00:00:00+05:30`).getTime() / 1000);
  }
  if (range?.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to)) {
    to = Math.floor(new Date(`${range.to}T23:59:59+05:30`).getTime() / 1000);
  }
  const auth = await authHeader();
  const out: RazorpayPayment[] = [];
  let truncated = false;
  // Razorpay pages at 100 per call — walk with skip until the account runs
  // out, the cap is reached, or we run short of time.
  const deadline = Date.now() + 45_000;
  for (let skip = 0; ; skip += 100) {
    if (out.length >= max || Date.now() > deadline) { truncated = true; break; }
    const res = await fetch(`https://api.razorpay.com/v1/payments?from=${from}${to ? `&to=${to}` : ""}&count=100&skip=${skip}`, {
      headers: { Authorization: auth },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Razorpay list payments failed: ${res.status}`);
    const d = await res.json();
    const items = (d?.items ?? []) as RazorpayPayment[];
    out.push(...items);
    if (items.length < 100) break; // that was the last page
  }
  return { payments: out.slice(0, max), truncated };
}

// Verify the checkout signature (proves Razorpay produced this payment).
export async function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const secret = await getSecret("RAZORPAY_KEY_SECRET");
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Quick connectivity test: create (and not use) a ₹1 order. Confirms the keys
// work before going live. Returns a friendly status.
export async function testRazorpay(): Promise<{ ok: boolean; message: string }> {
  if (!(await razorpayConfigured())) return { ok: false, message: "No Razorpay keys saved yet." };
  try {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 100, currency: "INR", receipt: "key-test" }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, message: "✅ Razorpay keys are valid — a test order was created successfully." };
    if (res.status === 401) return { ok: false, message: "❌ Keys rejected (401). Double-check the Key ID and Secret." };
    return { ok: false, message: `❌ Razorpay returned ${res.status}. Check the keys and try again.` };
  } catch (e) {
    return { ok: false, message: "❌ Couldn't reach Razorpay: " + String(e) };
  }
}
