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
