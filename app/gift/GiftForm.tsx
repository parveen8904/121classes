"use client";

import { useState } from "react";
import { parseSlabs, slabTotal, slabMonthOptions, formatINR } from "@/lib/pricing";
import Script from "next/script";
import AttemptPicker from "@/app/components/AttemptPicker";
import AddressFields from "@/app/components/AddressFields";
import { createGiftOrder, verifyGiftPayment, } from "./actions";
import { EMPTY_ADDRESS, addressProblems, type Address } from "@/lib/address";

type Subject = { id: string; title: string; course: string; gold: number | null; validityMonths: number; goldSlabs: unknown; batchMonths?: number | null; batchPriceInr?: number | null };
type Plan = { tier: string; name: string; price: number | null };

export default function GiftForm({ configured, subjects, plans }: { configured: boolean; subjects: Subject[]; plans: Plan[] }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const tier = "gold"; // sponsors gift Gold only
  const [months, setMonths] = useState(12);
  const [rName, setRName] = useState(""); const [rEmail, setREmail] = useState(""); const [rPhone, setRPhone] = useState("");
  const [rAttempt, setRAttempt] = useState("");
  // TWO ADDRESSES, KEPT APART ON PURPOSE. Ravi's spec, 2 Sep 2026: the
  // recipient section and the sponsor billing section each get their own
  // Address, City, State and PIN. The invoice is the sponsor's; the parcel is
  // the student's; they are rarely the same place, and one textarea could not
  // express that.
  const [rAddr, setRAddr] = useState<Address>(EMPTY_ADDRESS);
  const [bAddr, setBAddr] = useState<Address>(EMPTY_ADDRESS);
  const [bName, setBName] = useState(""); const [bGstin, setBGstin] = useState("");
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!window.Razorpay) { setErr("Payment library still loading — try again in a moment."); return; }
    if (!subjectId || !rName || !rEmail) { setErr("Please fill the recipient's name and email."); return; }
    const bad = addressProblems(bAddr, { needPhone: false, indiaOnly: false });
    if (bad.length) { setErr(`Your billing address still needs: ${bad.join(", ")}.`); return; }
    setBusy(true);
    try {
      const res = await createGiftOrder({
        subjectId, tier, months, couponCode: coupon,
        recipient: { name: rName, email: rEmail, phone: rPhone, attempt: rAttempt,
          addr: { ...rAddr, name: rAddr.name || rName, phone: rAddr.phone || rPhone } },
        billing: { name: bName || rName, gstin: bGstin, tradeName: bName,
          addr: { ...bAddr, name: bAddr.name || bName || rName } },
      });
      if (!res.ok) {
        setErr(res.reason === "unconfigured" ? "Payment isn't enabled yet."
          : res.reason === "address" ? "This 9+ month Gold gift includes FREE printed books (delivered within India only) — please fill the recipient's Indian delivery address before paying."
          : "Couldn't start checkout — please check the details and try again.");
        return;
      }
      const Rzp = (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay;
      const rzp = new Rzp({
        key: res.keyId, amount: res.amount, currency: "INR", name: res.name, description: res.description,
        order_id: res.orderId, prefill: res.prefill, theme: { color: "#0d9488" },
        handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          const v = await verifyGiftPayment(resp);
          if (v.ok) setDone(true); else setErr("Payment received but setup failed — please contact us with your payment id.");
        },
      });
      rzp.open();
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="card" style={{ marginTop: 16, borderLeft: "4px solid #16a34a" }}>
        <h3 style={{ marginTop: 0 }}>🎉 Gift sent!</h3>
        <p>{rName} has been given access and emailed a link to set their password. Your GST invoice &amp; receipt have been emailed to you. They never see the amount you paid.</p>
      </div>
    );
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <form onSubmit={pay} className="form-card" style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>1️⃣ What to gift</h3>
        <div>
          <label>Subject</label>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}{s.course ? ` — ${s.course}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label>Plan</label>
          <input value={plans[0]?.name ? `${plans[0].name} (full premium access)` : "Gold"} readOnly style={{ background: "var(--bg-soft)" }} />
        </div>
        {(() => {
          const subj = subjects.find((x) => x.id === subjectId);
          // Live batches are one fixed-price package — no duration choice.
          const batchM = Number(subj?.batchMonths) || 0;
          if (batchM > 0) {
            const price = Number(subj?.batchPriceInr) || 0;
            return (
              <div>
                <label>Package</label>
                <p style={{ margin: "4px 0 0" }}>
                  🔴 Live batch — {batchM} month{batchM === 1 ? "" : "s"} access (live classes + recordings)
                </p>
                {price > 0 ? (
                  <p style={{ fontWeight: 800, margin: "8px 0 0" }}>
                    🎁 Gift value: {formatINR(price)}
                    <span className="muted" style={{ fontWeight: 500, fontSize: ".8rem" }}> · includes GST</span>
                  </p>
                ) : (
                  <p className="muted" style={{ margin: "8px 0 0" }}>Price to be announced — please check back soon.</p>
                )}
              </div>
            );
          }
          const slabs = parseSlabs(subj?.goldSlabs);
          const choices = slabs ? slabMonthOptions(slabs) : [3, 6, 12, 24];
          const base = subj?.validityMonths || 12;
          const total = slabs
            ? slabTotal(slabs, months)
            : subj?.gold ? Math.max(1, Math.round((subj.gold * months) / base)) : null;
          return (
            <div>
              <label>Duration (longer = cheaper per month)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {choices.map((m) => (
                  <button key={m} type="button" onClick={() => setMonths(m)} className="btn small secondary"
                    style={months === m ? { background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", borderColor: "transparent" } : undefined}>
                    {m}m{slabs ? ` · ${formatINR(slabTotal(slabs, m))}` : ""}
                  </button>
                ))}
              </div>
              <input type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value) || 12)} placeholder="…or custom months" style={{ maxWidth: 180 }} />
              {total != null && (
                <p style={{ fontWeight: 800, margin: "8px 0 0" }}>
                  🎁 Gift value: {formatINR(total)}
                  {months > 0 && <span className="muted" style={{ fontWeight: 500 }}> · ≈ {formatINR(Math.round(total / months))}/month</span>}
                  <span className="muted" style={{ fontWeight: 500, fontSize: ".8rem" }}> · includes GST</span>
                </p>
              )}
            </div>
          );
        })()}

        <h3 style={{ margin: "8px 0 0" }}>2️⃣ Who it&apos;s for (the recipient)</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Full name *</label><input value={rName} onChange={(e) => setRName(e.target.value)} required /></div>
          <div><label>Email * (their login)</label><input type="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} required /></div>
          <div><label>Phone</label><input value={rPhone} onChange={(e) => setRPhone(e.target.value)} /></div>
          <div><label>Exam attempt</label><AttemptPicker name="rAttempt" defaultValue={rAttempt} allowNone /></div>
        </div>
        <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>
          Where the books go. A Gold gift of nine months or more includes the printed set, free — and a courier needs
          the parts, not a paragraph.
        </p>
        <AddressFields idPrefix="gr" value={rAddr} onChange={setRAddr} />

        <h3 style={{ margin: "8px 0 0" }}>3️⃣ Your billing details (for the invoice)</h3>
        <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>
          Kept separately from the address above: the invoice is yours, the parcel is theirs.
        </p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Your name / company</label><input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="as it should appear on the invoice" /></div>
          <div>
            <label>Your GST number (optional)</label>
            {/* NO VERIFY BUTTON — removed 4 September 2026, "we do not require
                the GST verification functionality". Typed and taken as given. */}
            <input value={bGstin} style={{ fontFamily: "ui-monospace, monospace", letterSpacing: ".04em" }}
              onChange={(e) => setBGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15))}
              placeholder="15 characters" />
          </div>
        </div>
        {/* The state here is what decides CGST+SGST against IGST on YOUR
            invoice, which is why it is chosen and not typed. */}
        <AddressFields idPrefix="gb" value={bAddr} onChange={setBAddr}
          requirePhone={false} showLandmark={false} allowOutsideIndia />

        <div style={{ maxWidth: 260 }}>
          <label>Coupon code (optional)</label>
          <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="e.g. GIFT20" />
        </div>
        {err && <div className="notice err">{err}</div>}
        <button className="btn" type="submit" disabled={busy || !configured}>{busy ? "Starting…" : "🎁 Pay & gift this Education Gift subscription"}</button>
        <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>
          Your payment receipt and a GST-compliant invoice are emailed to you. {rName || "The recipient"} gets access and a link to set their password — they never see the amount.
        </p>
      </form>
    </>
  );
}
