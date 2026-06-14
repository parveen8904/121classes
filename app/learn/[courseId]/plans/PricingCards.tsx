"use client";

import { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { formatINR } from "@/lib/pricing";
import { TIER_META, TIER_RANK } from "@/lib/tiers";
import { createPlanOrder, verifyPlanPayment } from "./payActions";

type Subject = {
  id: string;
  title: string;
  gold_price_inr: number | null;
  validity_months: number;
};

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
  subject,
  facultyNames,
  silverPrice,
  currentTier,
  courseId,
  configured,
  contactHref,
}: {
  subject: Subject;
  facultyNames: string;
  silverPrice: number | null;
  currentTier: string | null;
  courseId: string;
  configured: boolean;
  contactHref: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");

  // Price per tier for THIS subject. Bronze free; Silver flat; Gold per-subject.
  const tierPrice: Record<string, number | null> = {
    bronze: 0,
    silver: silverPrice,
    gold: subject.gold_price_inr,
  };

  async function buy(tier: string) {
    if (!window.Razorpay) {
      alert("Payment library is still loading — please try again in a moment.");
      return;
    }
    setBusy(tier);
    try {
      const res = await createPlanOrder({ subjectId: subject.id, tier, couponCode: coupon });
      if (!res.ok) {
        if (res.reason === "unconfigured") window.location.href = contactHref;
        else if (res.reason === "noprice") alert("This plan isn't priced yet — please contact us and we'll enrol you.");
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

  const tiers = ["bronze", "silver", "gold"];

  return (
    <>
      {configured && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />}

      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <strong>{subject.title}</strong>
        {facultyNames && <span className="muted"> · {facultyNames}</span>}
        <div className="muted" style={{ fontSize: ".82rem" }}>
          Paid plans give {subject.validity_months} months access.
        </div>
      </div>

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
        {tiers.map((tier) => {
          const meta = TIER_META[tier];
          const price = tierPrice[tier];
          const isFree = tier === "bronze" || (price ?? 0) === 0;
          const owned = currentTier ? TIER_RANK[currentTier] >= TIER_RANK[tier] : false;
          const isCurrent = currentTier === tier;
          const noPrice = !isFree && (price === null || price === undefined);
          const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

          return (
            <div key={tier} className={`plan-card${tier === "gold" ? " featured" : ""}`}>
              {tier === "gold" && <span className="plan-pop">Full classes</span>}
              <div className="tier-name">{tierName}</div>
              <div className="tagline">{meta?.tagline}</div>

              {isFree ? (
                <div className="plan-price">Free</div>
              ) : noPrice ? (
                <div className="plan-price" style={{ fontSize: "1.3rem" }}>
                  On request
                </div>
              ) : (
                <>
                  <div className="plan-price">{formatINR(price as number)}</div>
                  <div className="plan-permonth">{subject.validity_months} months access</div>
                </>
              )}

              <ul className="feat-list">
                {meta?.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>

              {isFree ? (
                owned ? (
                  <div className="plan-current">✓ Included free</div>
                ) : (
                  <Link className="btn block secondary" href={`/learn/${courseId}`}>
                    Start free →
                  </Link>
                )
              ) : owned ? (
                <div className="plan-current">{isCurrent ? "✓ Your current plan" : "Included in your plan"}</div>
              ) : noPrice || !configured ? (
                <a className="btn block" href={contactHref}>
                  Get {tierName} →
                </a>
              ) : (
                <button className="btn block" type="button" disabled={busy === tier} onClick={() => buy(tier)}>
                  {busy === tier ? "Starting…" : `Get ${tierName} →`}
                </button>
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
