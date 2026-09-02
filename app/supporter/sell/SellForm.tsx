"use client";
import { formatDate } from "@/lib/dates";

import { useState, useEffect } from "react";
import Script from "next/script";
import Link from "next/link";
import { formatINR } from "@/lib/pricing";
import { INDIA_STATES, isIndianPincode } from "@/lib/indiaStates";
import { toAddress, type Address } from "@/lib/address";
import { createGiftOrder, verifyGiftPayment, previewGiftPrice } from "@/app/gift/actions";

// The supporter's order form, in the order they actually work.
//
// Who the student is → where the books go → which of the two subjects → when
// their access should start → the coupon → pay. Nothing else is asked, because
// nothing else changes what is sold: it is always Gold, always twelve months.

type Product = { id: string; title: string; course: string; priceInr: number; months: number; options?: { months: number; priceInr: number }[] };
// THE SPONSOR'S OWN BILLING ADDRESS, IN PARTS.
//
// Ravi's spec, 2 Sep 2026: "Sponsor Billing section currently has only one
// Address field. Add separate fields for Address, City, State and PIN Code.
// These details should be maintained separately and used for the Sponsor's
// invoice/billing."
//
// Maintained separately is exactly what happens: it comes from the vendor's own
// profile and is never editable on this page, because the invoice is theirs and
// the parcel is the student's. Only the shape changes here — a paragraph
// becomes the parts, so the invoice and the label are built from fields rather
// than from one string doing two jobs.
type Billing = { name: string; gstin: string; state: string; addr: Address };


const today = () => new Date().toISOString().slice(0, 10);

export default function SellForm({
  products, preselect, myCoupon, billing, configured, locked,
}: { products: Product[]; preselect?: string; myCoupon?: string; billing: Billing; configured: boolean; locked?: string }) {
  const [subjectId, setSubjectId] = useState(preselect || products[0]?.id || "");
  // Did they name the subject before they got here? A tile on their desk links
  // in with it; the plain "Place an order" button does not. Only a subject we
  // actually sell counts — a stale or hand-typed one falls back to asking.
  const chosenUpFront = !!preselect && products.some((p) => p.id === preselect);
  const [months, setMonths] = useState(12);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  // The delivery address in its parts. Composed into one label-shaped block
  // only when the order is placed, so the courier reads lines rather than a
  // paragraph somebody typed in a hurry.
  const [addr, setAddr] = useState({ line1: "", line2: "", city: "", state: "", pincode: "", country: "", inIndia: true });
  const [startsOn, setStartsOn] = useState(today());
  // Their own code, already in the box. They can clear it, but nobody has to
  // remember it — and nobody sells at full price by forgetting it.
  const [coupon, setCoupon] = useState(myCoupon ?? "");
  // What the coupon actually did, decided on the server. Null until they press
  // Apply — the amount on the button never moves on an unchecked code.
  const [applied, setApplied] = useState<{ payable: number; discount: number; code: string } | null>(null);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Read from their profile and never edited here — see the note further down.
  const bState = billing.state || "Delhi";
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);

  const product = products.find((p) => p.id === subjectId);
  const later = startsOn > today();
  const terms = product?.options?.length ? product.options : [{ months: 12, priceInr: product?.priceInr ?? 0 }];

  // THE TERM ON THE SCREEN AND THE TERM IN THE STATE MUST BE THE SAME TERM.
  //
  // `months` is remembered across a change of subject, and the two subjects do
  // not offer the same terms. Pick 24 months on one, switch to a subject that
  // stops at 12, and the fallback below quietly showed 12 in the summary while
  // NO radio was ticked — the screen said one thing in one place and nothing in
  // the other, and an order could be placed against a term nobody had chosen.
  //
  // So the fallback is not merely displayed, it is adopted: the state is
  // corrected to the term actually being shown.
  const term = terms.find((t) => t.months === months) ?? terms[0];
  useEffect(() => {
    if (term && term.months !== months) setMonths(term.months);
  }, [term, months]);
  // The price on the button, and the price sent to Razorpay.
  const payable = applied ? applied.payable : term?.priceInr ?? 0;

  // A coupon proved against ONE subject cannot stand once another is chosen.
  function forget() { setApplied(null); setCouponMsg(null); }

  async function applyCouponNow() {
    const code = coupon.trim();
    if (!code || !product) return;
    setChecking(true);
    setCouponMsg(null);
    try {
      const r = await previewGiftPrice({ subjectId, couponCode: code, months });
      if (r.ok && r.couponApplied) {
        setApplied({ payable: r.payable, discount: r.discount, code: r.couponCode ?? code });
        setCouponMsg({ ok: true, text: `Coupon applied successfully — ${formatINR(r.discount)} off.` });
      } else if (!r.ok && r.reason === "badcoupon") {
        setApplied(null);
        setCouponMsg({ ok: false, text: "That code is not valid, has expired, or is not for this purchase." });
      } else {
        setApplied(null);
        setCouponMsg({ ok: false, text: "Could not check the code just now. Please try again." });
      }
    } catch {
      setApplied(null);
      setCouponMsg({ ok: false, text: "Could not check the code just now. Please try again." });
    } finally {
      setChecking(false);
    }
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (locked) { setErr(locked); return; }
    if (!window.Razorpay) { setErr("Payment is still loading — one moment."); return; }
    if (!product) { setErr("Choose a subject."); return; }
    if (!name.trim() || !email.trim()) { setErr("The student's name and email are both needed — the login is created from them."); return; }
    // Each part named, so the seller is told which box is empty rather than
    // "the address is needed" over a form they think they filled.
    if (!addr.line1.trim()) { setErr("The books are posted to the student — please enter their address."); return; }
    if (!addr.city.trim()) { setErr("Please enter the student's city."); return; }
    if (!addr.state.trim()) { setErr(addr.inIndia ? "Please choose the student's state." : "Please enter the student's state or province."); return; }
    if (addr.inIndia && !isIndianPincode(addr.pincode)) { setErr("Please enter a valid 6-digit Indian PIN code — a parcel cannot be sorted without one."); return; }
    if (!addr.inIndia && !addr.pincode.trim()) { setErr("Please enter the student's postcode."); return; }
    if (!addr.inIndia && !addr.country.trim()) { setErr("Please enter the country."); return; }
    setBusy(true);
    try {
      const res = await createGiftOrder({
        subjectId, tier: "gold", months: term?.months ?? product.months, couponCode: coupon, startsOn,
        // The parcel goes to the STUDENT — these parts, not the vendor's.
        recipient: { name: name.trim(), email: email.trim(), phone: phone.trim(),
          addr: toAddress({ name: name.trim(), phone: phone.trim(), ...addr, country: addr.inIndia ? "India" : addr.country }) },
        billing: { name: billing.name || name, gstin: billing.gstin, tradeName: billing.name, addr: { ...billing.addr, state: bState } },
      });
      if (!res.ok) {
        setErr(res.reason === "blocked"
          ? "Your account is on hold following an upheld complaint. You can still see your orders and invoices, but no new order can be placed until the matter is settled. Please call the office."
          : res.reason === "incomplete" ? "Your profile is not complete yet, so payment cannot be taken. The list at the top of this page says exactly what is left — nothing you have typed here is lost."
          : res.reason === "nosite" ? "Add the website you sell from in My details first — it is required before placing an order."
          : res.reason === "unverified" ? "Your website is not verified yet. Open My details, publish the code on your site, and press Check my website."
          : res.reason === "unconfigured" ? "Payment is not switched on yet — please call the office."
          : res.reason === "address" ? "The student's full delivery address is needed before paying, because the printed books go to them."
          : res.reason === "auth" ? "Please sign in again."
          : "Could not start the payment. Check the details and try once more.");
        return;
      }
      const Rzp = (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay;
      new Rzp({
        key: res.keyId, amount: res.amount, currency: "INR", name: res.name, description: res.description,
        order_id: res.orderId, prefill: res.prefill, theme: { color: "#0d9488" },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const v = await verifyGiftPayment(r);
          if (v.ok) { setDone(true); } else { setErr("Payment taken but not confirmed — please call the office before paying again."); }
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch {
      setErr("Something went wrong starting the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>✅ Order placed</h2>
        <p>
          <strong>{name}</strong> has been emailed a link to set their password. They can sign in today and watch the
          demo classes; their full access opens on <strong>{formatDate(startsOn)}</strong>.
        </p>
        <p className="muted" style={{ fontSize: ".88rem" }}>
          Your invoice is on your desk under Your orders. The student is never told what was paid.
        </p>
        <a className="btn" href="/supporter">← Back to my desk</a>
      </div>
    );
  }

  // Steps are numbered as they are drawn, so a step that is not shown does not
  // leave a hole — and nobody has to remember to renumber the ones after it.
  let n = 0;
  const step = () => ++n;

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <form className="card" style={{ marginTop: 18 }} onSubmit={pay}>
        {!configured && <div className="notice err">Payment is not switched on yet — please call the office.</div>}

        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>{step()} · Who is the student?</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <div><label htmlFor="n">Full name</label><input id="n" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><label htmlFor="e">Email</label><input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><label htmlFor="p">Phone</label><input id="p" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: -4 }}>
          Their login is created from this email, so it must be theirs and correct.
        </p>

        {/* A DELIVERY ADDRESS IS NOT A PARAGRAPH.
            This was one free-text box headed "full postal address with PIN
            code". A courier label needs a city, a state and a PIN in their own
            right, and a seller typing in a hurry leaves out whichever one they
            leave out — usually the state, which is the one the courier sorts
            on. Separate boxes, and inside India the state is chosen, not typed.

            An address abroad is allowed. We do not courier books outside India,
            but that is a reason not to send a parcel, not a reason to refuse
            the sale — the student still gets the course and the free PDFs, and
            if they want the printed set they can give an Indian address of
            somebody who will forward it on. They are told so, plainly, and can
            change the address there and then. */}
        <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>{step()} · Where do the books go?</h2>

        <label htmlFor="ain">Country<span style={{ color: "#b91c1c" }}> *</span></label>
        <select id="ain" value={addr.inIndia ? "in" : "out"}
          onChange={(e) => setAddr({ ...addr, inIndia: e.target.value === "in", state: "" })}>
          <option value="in">India</option>
          <option value="out">Outside India</option>
        </select>

        {!addr.inIndia && (
          <div className="notice" style={{ background: "rgba(234,179,8,0.14)", border: "2px solid #eab308", color: "var(--text)", marginTop: 10 }}>
            📦 <strong>We do not courier the printed books outside India.</strong> The student still gets the full
            course and the book PDFs, which are free. If they want the printed set, put an Indian address here —
            a friend or relative who can post it on to them — and change the country back to India.
          </div>
        )}

        <label htmlFor="a1">Address<span style={{ color: "#b91c1c" }}> *</span></label>
        <input id="a1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })}
          required placeholder="Flat / house, building, street" />

        <label htmlFor="a2">Area, landmark <span className="muted" style={{ fontWeight: 400 }}>— optional</span></label>
        <input id="a2" value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} />

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
          <div>
            <label htmlFor="ac">City<span style={{ color: "#b91c1c" }}> *</span></label>
            <input id="ac" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} required />
          </div>
          <div>
            <label htmlFor="as">{addr.inIndia ? "State" : "State / province"}<span style={{ color: "#b91c1c" }}> *</span></label>
            {addr.inIndia ? (
              <select id="as" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} required>
                <option value="">Choose…</option>
                {INDIA_STATES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            ) : (
              <input id="as" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} required />
            )}
          </div>
          <div>
            <label htmlFor="ap">{addr.inIndia ? "PIN code" : "Postcode"}<span style={{ color: "#b91c1c" }}> *</span></label>
            <input id="ap" value={addr.pincode}
              inputMode={addr.inIndia ? "numeric" : "text"}
              maxLength={addr.inIndia ? 6 : 12}
              onChange={(e) => setAddr({ ...addr, pincode: addr.inIndia ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value })}
              required placeholder={addr.inIndia ? "6 digits" : ""} />
          </div>
          {!addr.inIndia && (
            <div>
              <label htmlFor="acn">Country<span style={{ color: "#b91c1c" }}> *</span></label>
              <input id="acn" value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })}
                required placeholder="e.g. United Arab Emirates" />
            </div>
          )}
        </div>
        <p className="muted" style={{ fontSize: ".8rem" }}>
          The printed books are posted to the student, not to you.
        </p>

        {/* WHICH SUBJECT — ONLY IF THEY HAVE NOT ALREADY SAID.
            They pick Financial Reporting or Advanced Accounting on their desk
            and press "Place an order" underneath it. Asking again three fields
            later reads as though the first answer was not heard, and invites a
            second, different answer — which is the sale going out wrong. So
            when the subject arrived with them it is shown as settled, with a
            way back to the desk if they picked the wrong tile. The plain
            "Place an order" button, which names no subject, still asks. */}
        {chosenUpFront ? (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
            border: "1.5px solid var(--accent)", borderRadius: 12, marginTop: 18,
          }}>
            <span style={{ flex: 1 }}>
              <strong>{product?.title}</strong>
              {/* THE TERM THEY HAVE ACTUALLY CHOSEN, NOT THE DEFAULT.
                  This read product.months and product.priceInr — the twelve-
                  month figures — and never moved. So picking 18 or 24 months
                  changed the summary at the bottom of the form while this card
                  went on saying twelve months and ₹9,897, and the seller had
                  two different prices on one screen. */}
              <span className="muted" style={{ display: "block", fontSize: ".82rem" }}>
                {product?.course} · Gold · {term?.months ?? product?.months} months
                {applied ? ` · ${applied.code} applied` : ""}
              </span>
            </span>
            <strong>
              {product ? formatINR(payable) : ""}
              {applied && applied.discount > 0 && (
                <span className="muted" style={{ fontWeight: 400, fontSize: ".8rem", textDecoration: "line-through", marginLeft: 6 }}>
                  {formatINR(term?.priceInr ?? product?.priceInr ?? 0)}
                </span>
              )}
            </strong>
            <Link href="/supporter" className="muted" style={{ fontSize: ".82rem", whiteSpace: "nowrap" }}>change</Link>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>{step()} · Which subject?</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {products.map((p) => (
                <label key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                  border: `1.5px solid ${p.id === subjectId ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 12, cursor: "pointer", marginBottom: 0,
                }}>
                  <input type="radio" name="subject" checked={p.id === subjectId} onChange={() => { setSubjectId(p.id); forget(); }} />
                  <span style={{ flex: 1 }}>
                    <strong>{p.title}</strong>
                    <span className="muted" style={{ display: "block", fontSize: ".82rem" }}>{p.course} · Gold · {p.months} months</span>
                  </span>
                  <strong>{formatINR(p.priceInr)}</strong>
                </label>
              ))}
            </div>
          </>
        )}

        {/* HOW LONG FOR.
            A supporter used to sell one shape only: twelve months, take it or
            leave it. A student sitting a later attempt needs their access to
            reach the exam, so a longer term can be sold — priced on exactly the
            ladder a student would pay, never a second price list. Shorter than
            a year is not offered: those slabs are for students topping up. */}
        {terms.length > 1 && (
          <>
            <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>4 · For how long?</h2>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              {terms.map((t) => (
                <label key={t.months} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  border: `1.5px solid ${t.months === months ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 12, cursor: "pointer", marginBottom: 0,
                }}>
                  <input type="radio" name="months" checked={t.months === months}
                    onChange={() => { setMonths(t.months); forget(); }} />
                  <span style={{ flex: 1 }}>
                    <strong>{t.months} months</strong>
                    <span className="muted" style={{ display: "block", fontSize: ".82rem" }}>{formatINR(t.priceInr)}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>{step()} · When should their access start?</h2>
        <input type="date" value={startsOn} min={today()} onChange={(e) => setStartsOn(e.target.value)} />
        <p className="muted" style={{ fontSize: ".82rem", marginTop: -6 }}>
          {later
            ? `Their ${term?.months ?? 12} months begin on that date — not today — so selling early costs them nothing. Until then they can sign in and watch the demo classes.`
            : "Starting today. Pick a later date if they are joining a future batch."}
        </p>

        <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>{step()} · Your discount</h2>

        {/* THE CODE ITSELF, RIGHT WHERE IT IS USED.
            It is theirs alone: it works only on an order placed for a student,
            and only while signed in as this account. Nobody else can use it, so
            there is nothing to hide — and a code kept out of sight is a code
            somebody forgets on a Friday evening and pays for themselves.
            Shown in full, selectable, and it can be used for every student they
            ever sell to. */}
        {myCoupon && (
          <div style={{
            display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
            border: "1.5px solid var(--accent)", borderRadius: 12,
            padding: "10px 14px", margin: "4px 0 10px", background: "var(--bg-soft)",
          }}>
            <span className="muted" style={{ fontSize: ".82rem" }}>Your code:</span>
            <code
              onClick={(e) => {
                // One tap selects the whole thing, so it can be copied on a
                // phone without fighting the text cursor.
                const r = document.createRange();
                r.selectNodeContents(e.currentTarget);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
              }}
              style={{
                fontSize: "1.05rem", fontWeight: 800, letterSpacing: ".05em",
                userSelect: "all", cursor: "text", wordBreak: "break-all",
              }}
            >
              {myCoupon}
            </code>
            {coupon.trim().toUpperCase() !== myCoupon.toUpperCase() && (
              <button type="button" className="btn small secondary"
                onClick={() => { setCoupon(myCoupon.toUpperCase()); forget(); }}>
                Use my code
              </button>
            )}
            <span className="muted" style={{ fontSize: ".78rem", flexBasis: "100%" }}>
              Yours alone — it only works on orders you place, while signed in as you. Use it for every student;
              there is no limit and no expiry.
              {/* A one-off code from the office is typed over this one. Without
                  saying so, a pre-filled box reads as fixed, and a vendor given
                  a special rate for one order would not know where to put it. */}
              {" "}Been given a different code for one order? Type it over the box below and press Apply.
            </span>
          </div>
        )}

        {myCoupon && coupon.trim().toUpperCase() === myCoupon.toUpperCase() && !applied && (
          <p className="muted" style={{ fontSize: ".84rem", marginTop: -4, lineHeight: 1.6 }}>
            Already filled in below. Press <strong>Apply</strong> to see what you pay.
          </p>
        )}

        {/* AN EMPTY BOX EXPLAINS NOTHING.
            A vendor arrives here with their own 25% code already in it. Anybody
            else — an admin looking at the screen to answer a question — sees an
            empty box and reasonably concludes the discount is missing. Say
            which of the two is happening. */}
        {!myCoupon && (
          <p className="muted" style={{ fontSize: ".84rem", marginTop: -4, lineHeight: 1.6 }}>
            No discount code is attached to this account. A registered vendor sees their own code here, filled in
            already; if you are a vendor and this box is empty, tell the office and we will put it right.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <input
            placeholder="Your discount code"
            value={coupon}
            onChange={(e) => { setCoupon(e.target.value.toUpperCase()); forget(); }}
            style={{ flex: "1 1 200px", marginBottom: 0 }}
          />
          <button type="button" className="btn secondary" onClick={applyCouponNow} disabled={!coupon.trim() || checking}>
            {checking ? "Checking…" : applied ? "Re-apply" : "Apply coupon"}
          </button>
        </div>
        {couponMsg && (
          <div className={`notice ${couponMsg.ok ? "ok" : "err"}`} style={{ marginTop: 10 }}>
            {couponMsg.ok ? "✅ " : "⚠️ "}{couponMsg.text}
          </div>
        )}

        {/* ASKED ONCE, ON THEIR PROFILE. NOT AGAIN HERE.
            Their billing state is already on file — this page will not even
            load without it — so putting the question a second time is not
            thoroughness, it is doubt. Worse, it let a vendor pick a state
            different from the one they are registered in, which puts the wrong
            tax split on their own invoice and is their problem to explain to
            their accountant, not ours to have caused. Shown, with the one
            place it can be changed. */}
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>
          🧾 Invoiced to <strong>{billing.name || "your business"}</strong> in <strong>{bState}</strong>
          {billing.gstin ? <> · GSTIN {billing.gstin}</> : null}
          {" — "}
          <Link href="/supporter/profile?next=/supporter/sell">change my details</Link>
        </p>

        {err && <div className="notice err" style={{ marginTop: 12 }}>⚠️ {err}</div>}

        {/* WHAT YOU WILL PAY, before you go anywhere near the payment screen.
            The button used to show the full price while Razorpay charged the
            discounted one, so the only way to find out what a coupon had done
            was to start paying. */}
        {product && (
          <div className="card" style={{ marginTop: 14, background: "var(--bg-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".9rem" }}>
              <span>{product.title} · Gold · {term?.months ?? product.months} months</span>
              <span style={{ textDecoration: applied ? "line-through" : "none", opacity: applied ? 0.6 : 1 }}>
                {formatINR(term?.priceInr ?? product.priceInr)}
              </span>
            </div>
            {applied && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".9rem", marginTop: 6 }}>
                <span>Coupon {applied.code}</span>
                <span>− {formatINR(applied.discount)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <span>To pay</span>
              <span>{formatINR(payable)}</span>
            </div>
          </div>
        )}

        {/* THE LOCK, WHERE IT IS ACTUALLY FELT.
            The notice at the top of the page explains it; this is the moment it
            matters. They can fill in every field above and see exactly what a
            student pays and what they pay — the one thing that does not happen
            is the payment. The server checks the same rule when an order is
            created, so this button is the courtesy, not the control. */}
        {locked ? (
          <div className="notice" style={{ marginTop: 14, background: "rgba(234,179,8,.14)", border: "2px solid #eab308", color: "var(--text)", lineHeight: 1.7 }}>
            🔒 <strong>{locked}</strong>
            <br />
            Everything above is ready and will still be here. Finish the steps at the top of this page and this
            becomes a payment button.
          </div>
        ) : (
        <button className="btn block" type="submit" disabled={busy || !configured} style={{ marginTop: 14 }}>
          {busy ? "Opening payment…" : product ? `Pay ${formatINR(payable)}` : "Choose a subject"}
        </button>
        )}
        <p className="muted" style={{ fontSize: ".78rem", marginTop: 8, textAlign: "center" }}>
          {applied
            ? "This is the amount Razorpay will charge."
            : coupon.trim()
              ? "Press “Apply coupon” to see your discounted amount before paying."
              : "GST is shown on your invoice."}
        </p>
      </form>
    </>
  );
}
