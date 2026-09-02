"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { createBookOrder, verifyBookPayment } from "./payActions";
import CheckoutAddressStep, { type Confirmed } from "@/app/components/CheckoutAddressStep";

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (resp: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
};
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

export default function BookCheckout({
  bookId,
  inStock,
  configured,
}: {
  bookId: string;
  inStock: boolean;
  configured: boolean;
}) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Nothing reaches the gateway until this is non-null; any edit clears it.
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [problem, setProblem] = useState<string[]>([]);

  if (!inStock) {
    return <p className="muted">⏳ This title is currently out of stock — please check back soon.</p>;
  }

  if (!configured) {
    return (
      <div className="card">
        <p className="muted">
          🛒 Online ordering is being set up. To order this book now, please{" "}
          <a href="/#contact" style={{ color: "var(--accent)" }}>
            contact us
          </a>{" "}
          and we&apos;ll arrange it. 🙌
        </p>
      </div>
    );
  }

  async function buy() {
    if (!window.Razorpay) {
      alert("Payment library is still loading — please try again in a moment.");
      return;
    }
    setBusy(true);
    setProblem([]);
    try {
      if (!confirmed) return;
      const res = await createBookOrder({ bookId, qty, buyer: confirmed });
      if (!res.ok) {
        if (res.reason === "invalid") { setProblem(res.missing ?? ["some required details"]); return; }
        else if (res.reason === "oos") alert("Sorry, this title just went out of stock.");
        else alert("Could not start checkout. Please try again or contact us.");
        return;
      }
      const rzp = new window.Razorpay({
        key: res.keyId,
        amount: res.amount,
        currency: "INR",
        name: res.name,
        description: res.description,
        order_id: res.orderId,
        prefill: res.prefill,
        theme: { color: "#0d9488" },
        handler: async (resp) => {
          const v = await verifyBookPayment(resp);
          if (v.ok) setDone(true);
          else alert("Payment received but verification failed — please contact us with your payment id.");
        },
      });
      rzp.open();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card">
        <h3>🎉 Order placed!</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          Thank you. Your book is on its way with free shipping 🚚. You&apos;ll get a confirmation by
          email.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <div className="card" style={{ marginBottom: 12 }}>
        <label style={{ margin: 0, width: 140 }}>
          Quantity
          <input type="number" min={1} max={20} value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </label>
      </div>

      <CheckoutAddressStep onConfirmedChange={setConfirmed} />

      <div className="card" style={{ marginTop: 12 }}>
        <button className="btn block" type="button" disabled={busy || !confirmed} onClick={buy}>
          {busy ? "Starting…" : confirmed ? "🔒 Buy now →" : "Confirm your details above to pay"}
        </button>
        {problem.length > 0 && (
          <ul style={{ margin: "8px 0 0 18px", fontSize: ".82rem", color: "#b91c1c" }}>
            {problem.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 10, textAlign: "center" }}>
          🔒 Secure checkout by Razorpay · 🚚 Free shipping across India
        </p>
      </div>
    </div>
  );
}
