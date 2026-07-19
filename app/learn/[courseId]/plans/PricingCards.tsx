"use client";

import { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { formatINR, parseSlabs, slabTotal, slabMonthOptions, type Slab } from "@/lib/pricing";
import { TIER_META, TIER_RANK } from "@/lib/tiers";
import { createPlanOrder, verifyPlanPayment, createExtendOrder, verifyExtendPayment } from "./payActions";
import Help from "@/app/components/Help";

type Subject = {
  id: string;
  title: string;
  gold_price_inr: number | null;
  validity_months: number;
  gold_slabs?: unknown;
  silver_slabs?: unknown;
  batch_months?: number | null;
  batch_price_inr?: number | null;
  included_with_title?: string | null;
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
  saleDiscountPct = 0,
  subMonthsTotal = null,
  subEndsAt = null,
  maxMonths = 36,
  batchWindow = null,
  batchCredit = 0,
  batchCreditTitle = "",
}: {
  subject: Subject;
  facultyNames: string;
  silverPrice: number | null;
  goldValidityOptions: number[];
  currentTier: string | null;
  courseId: string;
  configured: boolean;
  contactHref: string;
  saleDiscountPct?: number;
  subMonthsTotal?: number | null;
  subEndsAt?: string | null;
  maxMonths?: number;
  batchWindow?: { from: string; to: string; sessions: number; daysLabel?: string; timeLabel?: string } | null;
  batchCredit?: number;
  batchCreditTitle?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");

  // Slab ladders (per-subject) take precedence over the legacy flat pricing.
  const goldSlabs: Slab[] | null = parseSlabs(subject.gold_slabs);
  const silverSlabs: Slab[] | null = parseSlabs(subject.silver_slabs);
  const goldChoices = goldSlabs ? slabMonthOptions(goldSlabs) : goldValidityOptions;

  const goldBase = subject.validity_months || 12;
  const defaultMonths = goldChoices.includes(goldBase)
    ? goldBase
    : goldChoices[0] ?? goldBase;
  const [goldMonths, setGoldMonths] = useState<number>(defaultMonths);
  const [custom, setCustom] = useState("");

  // Gold price: slab total if a ladder is set, else scale the flat base price.
  const goldTotal = goldSlabs
    ? slabTotal(goldSlabs, goldMonths)
    : subject.gold_price_inr == null
      ? null
      : Math.max(1, Math.round((subject.gold_price_inr * goldMonths) / goldBase));

  // Silver: slab ladder if set (student chooses months), else the flat price.
  const silverTotal = silverSlabs ? slabTotal(silverSlabs, goldMonths) : silverPrice;

  const tierPrice: Record<string, number | null> = {
    bronze: 0,
    silver: silverTotal,
    gold: goldTotal,
  };
  const tierMonths: Record<string, number> = {
    bronze: 0,
    silver: silverSlabs ? goldMonths : subject.validity_months,
    gold: goldMonths,
  };
  const tierSlabbed: Record<string, boolean> = { bronze: false, silver: !!silverSlabs, gold: !!goldSlabs };

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

  // ---- Extend (owned Gold only) --------------------------------------------
  const batchM = Number(subject.batch_months) || 0;
  const batchPrice = Number(subject.batch_price_inr) || 0;
  const currentMonths = subMonthsTotal ?? 0;
  const remainingMonths = Math.max(0, maxMonths - currentMonths);
  const canExtend = currentTier === "gold" && subMonthsTotal != null && remainingMonths > 0;
  const extChoices = [1, 3, 6, 12].filter((m) => m <= remainingMonths);
  if (remainingMonths > 0 && !extChoices.includes(remainingMonths)) extChoices.push(remainingMonths);
  const [extMonths, setExtMonths] = useState<number>(extChoices[0] ?? 1);
  const [busyExt, setBusyExt] = useState(false);

  const extAdd = Math.min(remainingMonths, extMonths);
  const extNewTotal = currentMonths + extAdd;
  // Live batches extend at their flat per-month rate (batch price ÷ batch months).
  const extBase = batchM > 0
    ? (batchPrice > 0 ? Math.max(1, Math.round((batchPrice / batchM) * extAdd)) : 0)
    : goldSlabs
      ? slabTotal(goldSlabs, extNewTotal) - slabTotal(goldSlabs, currentMonths)
      : subject.gold_price_inr
        ? Math.max(1, Math.round((subject.gold_price_inr * extAdd) / goldBase))
        : 0;
  const extNet = saleDiscountPct > 0 ? Math.max(1, Math.round(extBase * (1 - saleDiscountPct / 100))) : extBase;

  async function extend() {
    if (!window.Razorpay) { alert("Payment library is still loading — please try again in a moment."); return; }
    setBusyExt(true);
    try {
      const res = await createExtendOrder({ subjectId: subject.id, addMonths: extMonths, couponCode: coupon });
      if (!res.ok) {
        if (res.reason === "unconfigured") window.location.href = contactHref;
        else if (res.reason === "atcap") alert("You're already at the maximum allowed duration for this course.");
        else if (res.reason === "nosub") alert("We couldn't find your active plan for this subject.");
        else alert("Could not start the extension. Please try again or contact us.");
        return;
      }
      const rzp = new window.Razorpay({
        key: res.keyId, amount: res.amount, currency: "INR", name: res.name, description: res.description,
        order_id: res.orderId, prefill: res.prefill, theme: { color: "#0d9488" },
        handler: async (resp) => {
          const v = await verifyExtendPayment(resp);
          if (v.ok) window.location.href = `/learn/${v.courseId ?? courseId}`;
          else alert("Payment received but verification failed. We'll sort it out — please contact us.");
        },
      });
      rzp.open();
    } finally { setBusyExt(false); }
  }

  const tiers = ["bronze", "silver", "gold"];

  // ---- Live batch: ONE fixed-price card (no Bronze/Silver, no month picker) ----
  if (batchM > 0) {
    const price = batchPrice;
    const owned = currentTier === "gold";
    const net = price > 0 && saleDiscountPct > 0 ? Math.max(1, Math.round(price * (1 - saleDiscountPct / 100))) : price;
    return (
      <>
        {configured && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />}
        <div className="plan-card featured" style={{ maxWidth: 460, margin: "0 auto" }}>
          <span className="plan-pop">🔴 LIVE batch</span>
          <div className="tier-name">{subject.title}</div>
          <div className="tagline">
            Taught LIVE by CA Parveen Sharma — recordings added after every class.
          </div>
          <ul className="feat-list" style={{ textAlign: "left", marginTop: 10 }}>
            <li>🥇 <strong>Gold</strong> access to this chapter — every live class + its recording</li>
            {subject.included_with_title && (
              <li>🥈 <strong>Silver</strong> access to the full <strong>{subject.included_with_title}</strong> — all MCQ &amp; descriptive tests + AI doubt-solving</li>
            )}
            <li>📚 Shared resources — RTPs, MTPs, past papers &amp; case scenarios</li>
          </ul>
          {batchWindow && (
            <div style={{ background: "var(--bg-soft)", borderRadius: 10, padding: "8px 12px", margin: "10px 0", fontSize: ".88rem" }}>
              {batchWindow.daysLabel && batchWindow.timeLabel && (
                <div>🕡 <strong>{batchWindow.daysLabel}</strong> at <strong>{batchWindow.timeLabel} IST</strong></div>
              )}
              🗓️ <strong>{batchWindow.from} → {batchWindow.to}</strong> · {batchWindow.sessions} live sessions
              <div className="muted" style={{ fontSize: ".8rem" }}>
                <Link href="/live" style={{ color: "var(--accent)", fontWeight: 700 }}>Full class-by-class schedule →</Link>
                {" "}· dates and timings may be adjusted — the schedule page is always current.
              </div>
            </div>
          )}
          {owned ? (
            <>
              <div className="plan-current" style={{ marginTop: 10 }}>✓ Included in your plan</div>
              {canExtend && configured && price > 0 && (
                <div style={{ marginTop: 12, borderTop: "1px dashed var(--border)", paddingTop: 12, textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: ".9rem", marginBottom: 2 }}>➕ Extend your access</div>
                  {subEndsAt && (
                    <div className="muted" style={{ fontSize: ".76rem", marginBottom: 8 }}>
                      Currently valid till {new Date(subEndsAt).toLocaleDateString("en-IN")}.
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {extChoices.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setExtMonths(m)}
                        className="btn small secondary"
                        style={extMonths === m ? { background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", borderColor: "transparent" } : undefined}
                      >
                        +{m}m
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: ".85rem", marginBottom: 8 }}>
                    Add {extAdd} month{extAdd === 1 ? "" : "s"} for{" "}
                    {extNet !== extBase && <span style={{ textDecoration: "line-through", opacity: 0.5, marginRight: 6 }}>{formatINR(extBase)}</span>}
                    <strong>{formatINR(extNet)}</strong>
                  </div>
                  <button className="btn block small" type="button" disabled={busyExt} onClick={extend}>
                    {busyExt ? "Starting…" : `Extend (+${extAdd} month${extAdd === 1 ? "" : "s"}) →`}
                  </button>
                </div>
              )}
            </>
          ) : price <= 0 ? (
            <>
              <div className="plan-price" style={{ fontSize: "1.3rem" }}>Price to be announced</div>
              <a className="btn block" href={contactHref}>Enquire →</a>
            </>
          ) : (
            <>
              <div className="plan-price">
                {net !== price && (
                  <span style={{ textDecoration: "line-through", opacity: 0.5, fontSize: "1rem", marginRight: 8, fontWeight: 500 }}>{formatINR(price)}</span>
                )}
                {formatINR(net)}
              </div>
              <div className="plan-permonth">
                {net !== price && <span style={{ color: "#16a34a", fontWeight: 700 }}>🎉 {saleDiscountPct}% off · </span>}
                One-time · {batchM} month{batchM === 1 ? "" : "s"} access (live month + recordings) · includes GST
              </div>
              {configured ? (
                <button className="btn block" type="button" disabled={busy === "gold"} onClick={() => buy("gold")} style={{ marginTop: 10 }}>
                  {busy === "gold" ? "Starting…" : "Join the Live Batch →"}
                </button>
              ) : (
                <a className="btn block" href={contactHref} style={{ marginTop: 10 }}>Join the Live Batch →</a>
              )}
              {configured && (
                <input
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  placeholder="🏷️ Coupon code (optional)"
                  style={{ marginTop: 10, marginBottom: 0, textAlign: "center" }}
                />
              )}
            </>
          )}
          {subject.included_with_title && (
            <p className="muted" style={{ fontSize: ".82rem", marginTop: 12 }}>
              💡 Already have <strong>{subject.included_with_title} Gold</strong>? This live batch is{" "}
              <strong>included free</strong> with your plan — nothing to buy.
            </p>
          )}
        </div>
        <p className="muted" style={{ textAlign: "center", fontSize: ".85rem", marginTop: 22 }}>
          {configured
            ? "🔒 Secure checkout by Razorpay · all prices include GST. Access unlocks the moment your payment succeeds."
            : "Online checkout is being set up. Tap the button to enquire and we'll enrol you right away. 🙌"}
        </p>
      </>
    );
  }

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
                    {goldChoices.map((m) => (
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
                (() => {
                  const full = price as number;
                  const saled = saleDiscountPct > 0 ? Math.max(1, Math.round(full * (1 - saleDiscountPct / 100))) : full;
                  // Migration credit: batch owners upgrading to the full subject pay the difference.
                  const credit = tier === "gold" && batchCredit > 0 ? Math.min(batchCredit, saled - 1) : 0;
                  const net = saled - credit;
                  return (
                    <>
                      <div className="plan-price">
                        {net !== full && (
                          <span style={{ textDecoration: "line-through", opacity: 0.5, fontSize: "1rem", marginRight: 8, fontWeight: 500 }}>{formatINR(full)}</span>
                        )}
                        {formatINR(net)}
                      </div>
                      <div className="plan-permonth">
                        {saled !== full && <span style={{ color: "#16a34a", fontWeight: 700 }}>🎉 {saleDiscountPct}% off · </span>}
                        {tierMonths[tier]} month{tierMonths[tier] === 1 ? "" : "s"} access
                        {tierSlabbed[tier] && tierMonths[tier] > 0 && (
                          <> · ≈ {formatINR(Math.round(net / tierMonths[tier]))}/month</>
                        )}
                      </div>
                      {credit > 0 && (
                        <div style={{ fontSize: ".8rem", color: "#16a34a", fontWeight: 700, marginTop: 4 }}>
                          🎉 Your {batchCreditTitle || "live batch"} payment ({formatINR(credit)}) is adjusted — pay only the difference.
                        </div>
                      )}
                    </>
                  );
                })()
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
                <>
                  <div className="plan-current">{isCurrent ? "✓ Your current plan" : "Included in your plan"}</div>
                  {tier === "gold" && canExtend && configured && (
                    <div style={{ marginTop: 12, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: ".9rem", marginBottom: 2 }}>➕ Extend your access</div>
                      {subEndsAt && (
                        <div className="muted" style={{ fontSize: ".76rem", marginBottom: 8 }}>
                          Currently valid till {new Date(subEndsAt).toLocaleDateString("en-IN")} · up to {maxMonths} months total for this course.
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {extChoices.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setExtMonths(m)}
                            className="btn small secondary"
                            style={extMonths === m ? { background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", borderColor: "transparent" } : undefined}
                          >
                            +{m}m
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: ".85rem", marginBottom: 8 }}>
                        Add {extAdd} month{extAdd === 1 ? "" : "s"} for{" "}
                        {extNet !== extBase && <span style={{ textDecoration: "line-through", opacity: 0.5, marginRight: 6 }}>{formatINR(extBase)}</span>}
                        <strong>{formatINR(extNet)}</strong>
                        <span className="muted"> · new expiry {extAdd} month{extAdd === 1 ? "" : "s"} later</span>
                      </div>
                      <button className="btn block small" type="button" disabled={busyExt} onClick={extend}>
                        {busyExt ? "Starting…" : `Extend (+${extAdd} month${extAdd === 1 ? "" : "s"}) →`}
                      </button>
                    </div>
                  )}
                  {tier === "gold" && currentTier === "gold" && subMonthsTotal != null && remainingMonths <= 0 && (
                    <div className="muted" style={{ fontSize: ".76rem", marginTop: 8 }}>You&apos;re at the maximum duration for this course.</div>
                  )}
                </>
              ) : noPrice || !configured ? (
                <a className="btn block" href={contactHref}>
                  Enroll in {tierName} →
                </a>
              ) : (
                <button className="btn block" type="button" disabled={busy === tier} onClick={() => buy(tier)}>
                  {busy === tier ? "Starting…" : `Enroll in ${tierName} →`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ textAlign: "center", fontSize: ".85rem", marginTop: 22 }}>
        {configured
          ? "🔒 Secure checkout by Razorpay · all prices include GST. Access unlocks the moment your payment succeeds."
          : "Online checkout is being set up. Tap Enroll to enquire and we'll enrol you right away. 🙌"}
      </p>
    </>
  );
}
