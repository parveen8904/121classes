import crypto from "crypto";

// Razorpay integration. All functions here are SERVER-ONLY (they use the
// secret key). The site works without keys — `razorpayConfigured()` is false
// and the UI falls back to "contact us / coming soon".

export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function authHeader(): string {
  const token = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  return `Basic ${token}`;
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  notes: Record<string, string>;
};

// Create an order (amount in rupees). Notes are stored by Razorpay and read
// back at verification time — that's our source of truth, not the client.
export async function createRazorpayOrder(
  amountInr: number,
  receipt: string,
  notes: Record<string, string>,
): Promise<RazorpayOrder> {
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.round(amountInr * 100),
      currency: "INR",
      receipt,
      notes,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Razorpay create order failed: ${res.status}`);
  return res.json();
}

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrder> {
  const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    headers: { Authorization: authHeader() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Razorpay fetch order failed: ${res.status}`);
  return res.json();
}

// Verify the checkout signature (proves Razorpay produced this payment).
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
