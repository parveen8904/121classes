"use client";

import { useState } from "react";
import Script from "next/script";
import { createBookOrder, verifyBookPayment } from "./payActions";

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
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: "",
  });

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

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
    try {
      const res = await createBookOrder({ bookId, qty, buyer: form });
      if (!res.ok) {
        if (res.reason === "invalid") alert("Please fill in all the required delivery details.");
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
    <div className="card">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <h3 style={{ marginBottom: 14 }}>🛒 Delivery details</h3>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label>Full name</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div>
          <label>Phone</label>
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} required />
        </div>
      </div>
      <label>Email</label>
      <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
      <label>Address line 1</label>
      <input value={form.line1} onChange={(e) => set("line1", e.target.value)} required />
      <label>Address line 2</label>
      <input value={form.line2} onChange={(e) => set("line2", e.target.value)} />
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div>
          <label>City</label>
          <input value={form.city} onChange={(e) => set("city", e.target.value)} required />
        </div>
        <div>
          <label>State</label>
          <input value={form.state} onChange={(e) => set("state", e.target.value)} />
        </div>
        <div>
          <label>PIN code</label>
          <input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} required />
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 6 }}>
        <div style={{ width: 120 }}>
          <label>Quantity</label>
          <input
            type="number"
            min={1}
            max={20}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <button className="btn" type="button" disabled={busy} onClick={buy} style={{ marginTop: 8 }}>
          {busy ? "Starting…" : "Buy now →"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>
        🔒 Secure checkout by Razorpay · 🚚 Free shipping across India
      </p>
    </div>
  );
}
