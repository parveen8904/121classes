"use client";

import { useState } from "react";
import Script from "next/script";
import { formatINR } from "@/lib/pricing";
import { createPenaltyOrder, verifyPenaltyPayment } from "./penaltyActions";

// The same shape the other checkouts declare, so the global does not end up
// with two different ideas of what Razorpay takes.
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

// THE HOLD, AND THE BUTTON THAT ENDS IT.
//
// Shown only to a vendor who is actually on hold. It says what was found, shows
// the words that were found where there are any, and offers the one action that
// changes anything.
//
// It also says — prominently, not in small print — that a hold decided by the
// site check can be wrong, and that saying so costs nothing. A penalty somebody
// pays because arguing looked harder than paying is not a penalty, it is a fee
// for being unable to complain.
export default function PenaltyPay({
  reason, evidence, amountInr, auto,
}: { reason: string | null; evidence: string | null; amountInr: number; auto: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function pay() {
    setErr(null); setBusy(true);
    try {
      const res = await createPenaltyOrder();
      if (!res.ok) {
        setErr(
          res.reason === "notheld" ? "There is nothing to pay — the hold has already been lifted. Reload the page."
          : res.reason === "unconfigured" ? "Payment is not switched on yet — please call the office."
          : res.reason === "auth" ? "Please sign in again."
          : "Could not start the payment. Please try once more.",
        );
        setBusy(false);
        return;
      }
      if (!window.Razorpay) { setErr("Payment is still loading — one moment."); setBusy(false); return; }
      const rzp = new window.Razorpay({
        key: res.keyId,
        order_id: res.orderId,
        amount: res.amount * 100,
        currency: "INR",
        name: "CA Parveen Sharma Classes",
        description: res.name,
        prefill: res.prefill,
        handler: async (r) => {
          const v = await verifyPenaltyPayment({
            razorpay_order_id: r.razorpay_order_id,
            razorpay_payment_id: r.razorpay_payment_id,
            razorpay_signature: r.razorpay_signature,
          });
          if (v.ok) { setDone(true); window.location.reload(); }
          else setErr("The payment went through but the hold could not be lifted here. Please call the office — do not pay again.");
        },
      });
      rzp.open();
    } catch {
      setErr("Could not start the payment. Please try once more.");
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderLeft: "4px solid #b91c1c", marginBottom: 18 }}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>⛔ Your account is on hold — you cannot place orders</h2>

      <p style={{ lineHeight: 1.7, margin: "6px 0" }}>
        Everything else still works: your orders, your invoices, and the students you have already sold to are
        unaffected. Only new orders are stopped.
      </p>

      {reason && (
        <p style={{ lineHeight: 1.7, margin: "6px 0" }}><strong>What was found:</strong> {reason}</p>
      )}
      {evidence && (
        <p className="muted" style={{ lineHeight: 1.7, margin: "6px 0", fontStyle: "italic" }}>
          On your page: “{evidence}”
        </p>
      )}

      <p style={{ lineHeight: 1.7, margin: "10px 0 6px" }}>
        To lift it: correct the page, then pay the penalty of <strong>{formatINR(amountInr)}</strong>. Orders reopen
        the moment the payment goes through — you do not have to wait for anybody.
      </p>

      {err && <div className="notice err" style={{ marginTop: 8 }}>⚠️ {err}</div>}
      {done && <div className="notice ok" style={{ marginTop: 8 }}>✓ Paid — reopening your account…</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <button className="btn" type="button" onClick={pay} disabled={busy || done}>
          {busy ? "Opening payment…" : `Pay ${formatINR(amountInr)} and lift the hold`}
        </button>
        <a className="btn secondary small" href="mailto:contact@caparveensharma.com?subject=Hold%20on%20my%20seller%20account">
          I think this is a mistake
        </a>
      </div>

      {auto && (
        <p className="muted" style={{ fontSize: ".82rem", lineHeight: 1.7, marginTop: 12, marginBottom: 0 }}>
          This hold was decided automatically from what was on your page, and a machine reading a shop page can
          misread one. <strong>If it is wrong, say so and it is lifted without any payment</strong> — write to
          contact@caparveensharma.com or call 98100 12674. Please do not pay a penalty you do not owe.
        </p>
      )}
    </div>
  );
}
