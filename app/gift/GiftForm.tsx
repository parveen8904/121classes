"use client";

import { useState } from "react";
import Script from "next/script";
import AttemptPicker from "@/app/components/AttemptPicker";
import { createGiftOrder, verifyGiftPayment } from "./actions";

type Subject = { id: string; title: string; course: string; gold: number | null };
type Plan = { tier: string; name: string; price: number | null };

const STATES = ["Delhi", "Haryana", "Uttar Pradesh", "Punjab", "Rajasthan", "Maharashtra", "Gujarat", "Karnataka", "Tamil Nadu", "Telangana", "West Bengal", "Bihar", "Madhya Pradesh", "Kerala", "Andhra Pradesh", "Uttarakhand", "Himachal Pradesh", "Jharkhand", "Chhattisgarh", "Odisha", "Assam", "Goa", "Chandigarh", "Jammu and Kashmir", "Other"];

export default function GiftForm({ configured, subjects, plans }: { configured: boolean; subjects: Subject[]; plans: Plan[] }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const tier = "gold"; // sponsors gift Gold only
  const [months, setMonths] = useState(12);
  const [rName, setRName] = useState(""); const [rEmail, setREmail] = useState(""); const [rPhone, setRPhone] = useState("");
  const [rAttempt, setRAttempt] = useState(""); const [rAddr, setRAddr] = useState("");
  const [bName, setBName] = useState(""); const [bGstin, setBGstin] = useState(""); const [bAddr, setBAddr] = useState(""); const [bState, setBState] = useState("Delhi");
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!window.Razorpay) { setErr("Payment library still loading — try again in a moment."); return; }
    if (!subjectId || !rName || !rEmail || !bState) { setErr("Please fill the recipient's name & email and your state."); return; }
    setBusy(true);
    try {
      const res = await createGiftOrder({
        subjectId, tier, months, couponCode: coupon,
        recipient: { name: rName, email: rEmail, phone: rPhone, attempt: rAttempt, address: rAddr },
        billing: { name: bName || rName, gstin: bGstin, address: bAddr, state: bState },
      });
      if (!res.ok) { setErr(res.reason === "unconfigured" ? "Payment isn't enabled yet." : "Couldn't start checkout — please check the details and try again."); return; }
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
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Plan</label>
            <input value={plans[0]?.name ? `${plans[0].name} (full premium access)` : "Gold"} readOnly style={{ background: "var(--bg-soft)" }} />
          </div>
          <div>
            <label>Months</label>
            <input type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value) || 12)} />
          </div>
        </div>

        <h3 style={{ margin: "8px 0 0" }}>2️⃣ Who it&apos;s for (the recipient)</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Full name *</label><input value={rName} onChange={(e) => setRName(e.target.value)} required /></div>
          <div><label>Email * (their login)</label><input type="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} required /></div>
          <div><label>Phone</label><input value={rPhone} onChange={(e) => setRPhone(e.target.value)} /></div>
          <div><label>Exam attempt</label><AttemptPicker name="rAttempt" defaultValue={rAttempt} allowNone /></div>
        </div>
        <div><label>Address (optional)</label><textarea rows={2} value={rAddr} onChange={(e) => setRAddr(e.target.value)} /></div>

        <h3 style={{ margin: "8px 0 0" }}>3️⃣ Your billing details (for the invoice)</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Your name / company</label><input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="as it should appear on the invoice" /></div>
          <div><label>Your GSTIN (optional)</label><input value={bGstin} onChange={(e) => setBGstin(e.target.value)} placeholder="for input credit" /></div>
          <div style={{ gridColumn: "1 / -1" }}><label>Billing address</label><textarea rows={2} value={bAddr} onChange={(e) => setBAddr(e.target.value)} /></div>
          <div><label>Your state * (decides CGST+SGST vs IGST)</label>
            <select value={bState} onChange={(e) => setBState(e.target.value)}>{STATES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
          </div>
        </div>

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
