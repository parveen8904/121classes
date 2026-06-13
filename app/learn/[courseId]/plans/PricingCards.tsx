"use client";

import { useState } from "react";
import Script from "next/script";
import { DURATIONS, computePrice, durationDiscount, durationLabel, formatINR } from "@/lib/pricing";
import { TIER_META, TIER_RANK } from "@/lib/tiers";
import { createPlanOrder, verifyPlanPayment } from "./payActions";

type Plan = { id: string; tier: string; name: string; web_price_inr: number | null };

// Minimal shape of the Razorpay checkout we use.
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

export default function PricingCards({
  plans,
  currentTier,
  courseId,
  configured,
  contactHref,
}: {
  plans: Plan[];
  currentTier: string | null;
  courseId: string;
  configured: boolean;
  contactHref: string;
}) {
  const [months, setMonths] = useState<number>(6);
  const [busy, setBusy] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const discount = Math.round(durationDiscount(months) * 100);

  async function buy(tier: string) {
    if (!window.Razorpay) {
      alert("Payment library is still loading — please try again in a moment.");
      return;
    }
    setBusy(tier);
    try {
      const res = await createPlanOrder({ courseId, tier, months, couponCode: coupon });
      if (!res.ok) {
        if (res.reason === "unconfigured") window.location.href = contactHref;
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
          const v = await verifyPlanPayment(resp);
          if (v.ok) window.location.href = `/learn/${v.courseId ?? courseId}`;
          else alert("Payment received but verification failed. We'll sort it out — please contact us.");
        },
      });
      rzp.open();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {configured && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />}

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <div className="seg" role="group" aria-label="Billing duration">
          {DURATIONS.map((m) => (
            <button key={m} type="button" className={m === months ? "active" : ""} onClick={() => setMonths(m)}>
              {durationLabel(m)}
            </button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ textAlign: "center", fontSize: ".82rem", marginBottom: 6 }}>
        {discount > 0 ? `Save ${discount}% versus paying monthly 🎉` : "Billed for one month"}
      </p>
      {configured && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <input
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="🏷️ Coupon code (optional)"
            style={{ maxWidth: 240, marginBottom: 0, textAlign: "center" }}
          />
        </div>
      )}

      <div className="plans-grid">
        {plans.map((p) => {
          const meta = TIER_META[p.tier];
          const total = computePrice(p.web_price_inr, months);
          const perMonth = Math.round(total / months);
          const owned = currentTier ? TIER_RANK[currentTier] >= TIER_RANK[p.tier] : false;
          const isCurrent = currentTier === p.tier;
          return (
            <div key={p.id} className={`plan-card${p.tier === "silver" ? " featured" : ""}`}>
              {p.tier === "silver" && <span className="plan-pop">Most popular</span>}
              <div className="tier-name">{p.name}</div>
              <div className="tagline">{meta?.tagline}</div>
              <div className="plan-price">
                {formatINR(total)} <small>/ {durationLabel(months)}</small>
              </div>
              <div className="plan-permonth">≈ {formatINR(perMonth)} / month</div>
              <ul className="feat-list">
                {meta?.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {owned ? (
                <div className="plan-current">{isCurrent ? "✓ Your current plan" : "Included in your plan"}</div>
              ) : configured ? (
                <button className="btn block" type="button" disabled={busy === p.tier} onClick={() => buy(p.tier)}>
                  {busy === p.tier ? "Starting…" : `Get ${p.name} →`}
                </button>
              ) : (
                <a className="btn block" href={contactHref}>
                  Get {p.name} →
                </a>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ textAlign: "center", fontSize: ".85rem", marginTop: 22 }}>
        {configured
          ? "🔒 Secure checkout by Razorpay. Access unlocks the moment your payment succeeds."
          : "Online checkout is being set up. Tap Get to enquire and we'll enrol you right away. 🙌"}
      </p>
    </>
  );
}
