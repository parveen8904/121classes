"use client";

import { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { formatINR } from "@/lib/pricing";
import { TIER_META, TIER_RANK } from "@/lib/tiers";
import { createPlanOrder, verifyPlanPayment } from "./payActions";
import Help from "@/app/components/Help";

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
  goldValidityOptions,
  currentTier,
  courseId,
  configured,
  contactHref,
}: {
  subject: Subject;
  facultyNames: string;
  silverPrice: number | null;
  goldValidityOptions: number[];
  currentTier: string | null;
  courseId: string;
  configured: boolean;
  contactHref: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");

  const goldBase = subject.validity_months || 12;
  const defaultMonths = goldValidityOptions.includes(goldBase)
    ? goldBase
    : goldValidityOptions[0] ?? goldBase;
  const [goldMonths, setGoldMonths] = useState<number>(defaultMonths);
  const [custom, setCustom] = useState("");

  // Gold price scales with the chosen validity from the subject's base price.
  const goldTotal =
    subject.gold_price_inr == null
      ? null
      : Math.max(1, Math.round((subject.gold_price_inr * goldMonths) / goldBase));

  const tierPrice: Record<string, number | null> = {
    bronze: 0,
    silver: silverPrice,
    gold: goldTotal,
  };
  const tierMonths: Record<string, number> = {
    bronze: 0,
    silver: subject.validity_months,
    gold: goldMonths,
  };

  function setCustomMonths(v: string) {
    setCustom(v);
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) setGoldMonths(Math.min(60, n));
  }

  async function buy(tier: string) {
    if (!window.Razorpay) {
      alert("Payment library is still loading — please try again in a moment.");
      return;
    }
    setBusy(tier);
    try {
      const res = await createPlanOrder({
        subjectId: subject.id,
        tier,
        months: tier === "gold" ? goldMonths : undefined,
        couponCode: coupon,
      });
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

              {/* Gold validity selector */}
              {tier === "gold" && !noPrice && !owned && (
                <div style={{ margin: "8px 0 12px" }}>
                  <label style={{ fontSize: ".78rem" }}>
                    Choose validity
                    <Help text="How long you want Gold access for. A longer validity costs more but works out cheaper per month. Pick a preset or enter your own number of months." />
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {goldValidityOptions.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setGoldMonths(m);
                          setCustom("");
                        }}
                        className="btn small secondary"
                        style={
                          goldMonths === m && !custom
                            ? { background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", borderColor: "transparent" }
                            : undefined
                        }
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={custom}
                    onChange={(e) => setCustomMonths(e.target.value)}
                    placeholder="…or custom months"
                    style={{ marginBottom: 0, fontSize: ".85rem" }}
                  />
                </div>
              )}

              {isFree ? (
                <div className="plan-price">Free</div>
              ) : noPrice ? (
                <div className="plan-price" style={{ fontSize: "1.3rem" }}>
                  On request
                </div>
              ) : (
                <>
                  <div className="plan-price">{formatINR(price as number)}</div>
                  <div className="plan-permonth">{tierMonths[tier]} months access</div>
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
