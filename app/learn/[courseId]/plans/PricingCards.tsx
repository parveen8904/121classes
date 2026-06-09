"use client";

import { useState } from "react";
import { DURATIONS, computePrice, durationDiscount, durationLabel, formatINR } from "@/lib/pricing";
import { TIER_META, TIER_RANK } from "@/lib/tiers";

type Plan = { id: string; tier: string; name: string; web_price_inr: number | null };

export default function PricingCards({
  plans,
  currentTier,
  contactHref,
}: {
  plans: Plan[];
  currentTier: string | null;
  contactHref: string;
}) {
  const [months, setMonths] = useState<number>(6);
  const discount = Math.round(durationDiscount(months) * 100);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <div className="seg" role="group" aria-label="Billing duration">
          {DURATIONS.map((m) => (
            <button
              key={m}
              type="button"
              className={m === months ? "active" : ""}
              onClick={() => setMonths(m)}
            >
              {durationLabel(m)}
            </button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ textAlign: "center", fontSize: ".82rem", marginBottom: 6 }}>
        {discount > 0 ? `Save ${discount}% versus paying monthly` : "Billed for one month"}
      </p>

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
                <div className="plan-current">{isCurrent ? "Your current plan" : "Included in your plan"}</div>
              ) : (
                <a className="btn block" href={contactHref}>
                  Get {p.name}
                </a>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ textAlign: "center", fontSize: ".85rem", marginTop: 22 }}>
        Online checkout is arriving soon. Tap <strong>Get</strong> to enquire and we&apos;ll enrol you
        right away.
      </p>
    </>
  );
}
