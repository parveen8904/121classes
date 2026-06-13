"use client";

import { useState } from "react";
import Script from "next/script";
import { createComboOrder, verifyComboPayment } from "./payActions";

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

export default function ComboCheckout({ comboId, configured }: { comboId: string; configured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!configured) {
    return (
      <a className="btn small" href="/#contact">
        Enquire to buy →
      </a>
    );
  }
  if (done) {
    return <span className="grad" style={{ fontWeight: 800 }}>🎉 Unlocked! Go to your dashboard.</span>;
  }

  async function buy() {
    if (!window.Razorpay) {
      alert("Payment library is still loading — please try again in a moment.");
      return;
    }
    setBusy(true);
    try {
      const res = await createComboOrder({ comboId });
      if (!res.ok) {
        if (res.reason === "auth") window.location.href = "/login?next=/combos";
        else if (res.reason === "unconfigured") window.location.href = "/#contact";
        else alert("Could not start checkout. Please try again.");
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
          const v = await verifyComboPayment(resp);
          if (v.ok) setDone(true);
          else alert("Payment received but verification failed — please contact us.");
        },
      });
      rzp.open();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <button className="btn small" type="button" disabled={busy} onClick={buy}>
        {busy ? "Starting…" : "Buy bundle →"}
      </button>
    </>
  );
}
