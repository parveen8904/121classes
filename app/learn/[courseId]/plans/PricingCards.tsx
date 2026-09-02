"use client";
import { formatDate } from "@/lib/dates";

import { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { formatINR, parseSlabs, slabTotal, slabMonthOptions, type Slab } from "@/lib/pricing";
import { TIER_META, TIER_RANK } from "@/lib/tiers";
import { createPlanOrder, verifyPlanPayment, createExtendOrder, verifyExtendPayment } from "./payActions";
import CheckoutAddressStep from "@/app/components/CheckoutAddressStep";
import { saveConfirmedDetails } from "@/app/books/cartActions";
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
  // 9 months is always offered — it's the FREE-printed-books threshold.
  const goldChoices = [...new Set([...(goldSlabs ? slabMonthOptions(goldSlabs) : goldValidityOptions), 9])].sort((a, b) => a - b);

  const goldBase = subject.validity_months || 12;
  const defaultMonths = goldChoices.includes(goldBase)
    ? goldBase
    : goldChoices[0] ?? goldBase;
  const [goldMonths, setGoldMonths] = useState<number>(defaultMonths);
  const [custom, setCustom] = useState("");
  // 9+ month Gold: printed books ship free within India; untick to decline
  // (outside India / PDF-only preference).
  const [wantBooks, setWantBooks] = useState(true);
  // Which tier is waiting on an address. Null = nothing is being asked.
  const [askAddress, setAskAddress] = useState<string | null>(null);
  const [addrErr, setAddrErr] = useState("");
  const [savingAddr, setSavingAddr] = useState(false);

  // Gold price: slab total if a ladder is set, else scale the flat base price.
  const goldTotal = goldSlabs
    ? slabTotal(goldSlabs, goldMonths)
    : subject.gold_price_inr == null
      ? null
      : Math.max(1, Math.round((subject.gold_price_inr * goldMonths) / goldBase));

  // Silver gets its own duration picker too: slab ladder if set, else the flat
  // Silver price scaled by the chosen months (base = the subject's validity).
  const silverChoices = silverSlabs ? slabMonthOptions(silverSlabs) : goldValidityOptions;
  const silverDefault = silverChoices.includes(goldBase) ? goldBase : silverChoices[0] ?? goldBase;
  const [silverMonths, setSilverMonths] = useState<number>(silverDefault);
  const [silverCustom, setSilverCustom] = useState("");
  const silverTotal = silverSlabs
    ? slabTotal(silverSlabs, silverMonths)
    : silverPrice == null
      ? null
      : Math.max(1, Math.round((silverPrice * silverMonths) / goldBase));

  const tierPrice: Record<string, number | null> = {
    bronze: 0,
    silver: silverTotal,
    gold: goldTotal,
  };
  const tierMonths: Record<string, number> = {
    bronze: 0,
    silver: silverMonths,
    gold: goldMonths,
  };
  const tierSlabbed: Record<string, boolean> = { bronze: false, silver: silverTotal != null, gold: !!goldSlabs };

  function setCustomMonths(v: string) {
    setCustom(v);
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) setGoldMonths(Math.min(60, n));
  }
  function setSilverCustomMonths(v: string) {
    setSilverCustom(v);
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) setSilverMonths(Math.min(60, n));
  }

  /**
   * EVERY ENROLMENT IS CONFIRMED BEFORE THE GATEWAY OPENS.
   *
   * Ravi's spec of 2 September, marked Critical: "No payment should be
   * initiated until the user confirms the Billing and Shipping details on
   * every enrollment... even if the student has enrolled previously and their
   * address details are already saved."
   *
   * That last clause is the point. The address was only ever asked for when the
   * server refused for want of one — so a student who moved in March and
   * enrolled again in September was never asked anything, and their books went
   * to the old flat. Now pressing Buy always opens the review; the payment
   * follows the confirmation.
   */
  function buy(tier: string) {
    setAskAddress(tier);
  }

  async function payNow(tier: string) {
    if (!window.Razorpay) {
      alert("Payment library is still loading — please try again in a moment.");
      return;
    }
    setBusy(tier);
    try {
      const res = await createPlanOrder({
        subjectId: subject.id,
        tier,
        months: tier === "gold" ? goldMonths : tier === "silver" ? silverMonths : undefined,
        couponCode: coupon,
        wantBooks,
      });
      if (!res.ok) {
        if (res.reason === "unconfigured") window.location.href = contactHref;
        else if (res.reason === "noprice") alert("This plan isn't priced yet — please contact us and we'll enrol you.");
        else if (res.reason === "notopen") alert("This batch has not opened for enrolment yet. Please check back on the start date.");
        else if (res.reason === "closed") alert("Enrolment for this batch has closed. Write to us and we will tell you when the next one opens.");
        else if (res.reason === "address") {
          // Should be unreachable now that the review runs first — but the
          // server is entitled to refuse, and sending them back to the same
          // screen is the right answer if it ever does.
          setAskAddress(tier);
        }
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
  // A live batch may be priced as one flat figure OR on the subject's ladder.
  // Reading only the flat figure showed "price to be announced" for a batch that
  // was in fact priced, on the ladder, exactly as intended.
  const batchFlat = Number(subject.batch_price_inr) || 0;
  const batchPrice = batchFlat > 0 ? batchFlat : (batchM > 0 && goldSlabs ? slabTotal(goldSlabs, batchM) : 0);
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
                      Currently valid till {formatDate(subEndsAt)}.
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

      {/* FIVE BOXES, ON THE PAGE THEY ARE ALREADY ON.
          Asked of everybody who pays, because every payment raises a GST
          invoice and an invoice must carry the buyer's address and state.
          Nothing to do with books: a student who declines the printed copies
          still needs an invoice, and a three-month plan has no books at all. */}
      {askAddress && (
        <div style={{ maxWidth: 620, margin: "0 auto 18px" }}>
          <CheckoutAddressStep
            heading="Billing & delivery for this enrolment"
            onConfirmedChange={async (d) => {
              if (!d) return;
              setSavingAddr(true); setAddrErr("");
              try {
                const r = await saveConfirmedDetails(d);
                if (!r.ok) { setAddrErr(r.error ?? "Could not save that."); return; }
                const tier = askAddress;
                setAskAddress(null);
                // They pressed Pay a moment ago; they should not have to find
                // the button again.
                if (tier) await payNow(tier);
              } finally { setSavingAddr(false); }
            }}
          />
          {addrErr && <div className="notice err" style={{ marginTop: 8 }}>⚠️ {addrErr}</div>}
          {savingAddr && <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>Saving…</p>}
          <button className="btn secondary block" type="button" style={{ marginTop: 8 }} onClick={() => setAskAddress(null)}>
            ← Back to the plans
          </button>
        </div>
      )}

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

              {/* Silver validity selector — same experience as Gold. */}
              {tier === "silver" && !noPrice && !owned && (
                <div style={{ margin: "8px 0 12px" }}>
                  <label style={{ fontSize: ".78rem" }}>
                    Choose validity
                    <Help text="How long you want Silver access for. Pick a preset or enter your own number of months." />
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {silverChoices.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setSilverMonths(m);
                          setSilverCustom("");
                        }}
                        className="btn small secondary"
                        style={
                          silverMonths === m && !silverCustom
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
                    value={silverCustom}
                    onChange={(e) => setSilverCustomMonths(e.target.value)}
                    placeholder="…or custom months"
                    style={{ marginBottom: 0, fontSize: ".85rem" }}
                  />
                </div>
              )}

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

              {/* Free printed books need a 9+ month Gold plan. Below that, offer
                  the Book Store so nobody checks out expecting free books.
                  Delivery is within India only — students abroad (or who just
                  don't want hard copies) can untick and use the free PDFs. */}
              {tier === "gold" && !noPrice && !owned && (
                (tierMonths.gold ?? 0) >= 9 ? (
                  <div style={{ fontSize: ".82rem", margin: "6px 0", padding: "8px 10px", borderRadius: 10, background: "color-mix(in srgb, #16a34a 10%, transparent)", border: "1px solid #16a34a" }}>
                    <label className="remember" style={{ margin: 0, fontWeight: 700, color: "#16a34a" }}>
                      <input type="checkbox" checked={wantBooks} onChange={(e) => setWantBooks(e.target.checked)} />{" "}
                      📦 Courier my FREE printed books (delivery within India only)
                    </label>
                    <span className="muted" style={{ display: "block", fontSize: ".76rem", marginTop: 4 }}>
                      {wantBooks
                        ? "Hard copies ship free to your profile address. Outside India? Untick — you still get the free PDF books."
                        : "No parcel will be sent — you'll use the free PDF books instead."}
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: ".8rem", margin: "6px 0", padding: "8px 10px", borderRadius: 10, background: "color-mix(in srgb, #f59e0b 12%, transparent)", border: "1px solid #f59e0b" }}>
                    📄 The book <strong>PDFs are free for every student</strong> — FREE printed hard copies come with{" "}
                    <strong>9+ month</strong> plans (a {tierMonths.gold}-month plan doesn&apos;t include printed copies).{" "}
                    <a className="grad" href="/books" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}>🛒 Add printed books →</a>
                  </div>
                )
              )}

              <ul className="feat-list">
                {(tier === "gold" ? meta?.features.filter((f) => !f.includes("printed books")) : meta?.features)?.map((f) => (
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
                          Currently valid till {formatDate(subEndsAt)} · up to {maxMonths} months total for this course.
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
