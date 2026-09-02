"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { getCartBooks, createCartOrder, verifyCartPayment, myAddressBook, type CartBook } from "../cartActions";
import { readCart, writeCart } from "../cartClient";
import { lightImg } from "@/lib/img";
import AddressFields from "@/app/components/AddressFields";
import GstinField from "@/app/components/GstinField";
import { EMPTY_ADDRESS, addressDifferences, type Address } from "@/lib/address";

type RazorpayOptions = {
  key: string; amount: number; currency: string; name: string; description: string; order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
};
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => { open: () => void } } }

export default function CartCheckout({ configured }: { configured: boolean }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [books, setBooks] = useState<CartBook[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [shipping, setShipping] = useState<Address>(EMPTY_ADDRESS);
  const [billing, setBilling] = useState<Address>(EMPTY_ADDRESS);
  const [sameAsShipping, setSameAsShipping] = useState(true);
  const [gstin, setGstin] = useState("");
  // What the profile held when the page loaded — kept so a difference can be
  // POINTED OUT rather than silently accepted or silently overwritten.
  const [onFile, setOnFile] = useState<{ shipping: Address; billing: Address; signedIn: boolean; hasProfileGstin: boolean } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    const c = readCart();
    setCart(c);
    const ids = Object.keys(c);
    if (!ids.length) { setLoaded(true); return; }
    getCartBooks(ids).then((bs) => { setBooks(bs); setLoaded(true); });
  }, []);

  // PREFILL FROM THE PROFILE, SO NOBODY TYPES THEIR ADDRESS TWICE IN A
  // LIFETIME. A guest gets empty fields, which is honest — we know nothing
  // about them.
  useEffect(() => {
    myAddressBook().then((b) => {
      setOnFile({ shipping: b.shipping, billing: b.billing, signedIn: b.signedIn, hasProfileGstin: b.hasProfileGstin });
      if (b.email) setEmail(b.email);
      if (b.shipping.line1 || b.shipping.name) setShipping(b.shipping);
      if (b.billing.line1) { setBilling(b.billing); setSameAsShipping(false); }
      if (b.gstin) setGstin(b.gstin);
    }).catch(() => { /* the checkout still works with empty fields */ });
  }, []);

  const shipDiff = onFile ? addressDifferences(shipping, onFile.shipping) : [];
  const billDiff = onFile && !sameAsShipping ? addressDifferences(billing, onFile.billing) : [];

  function setQty(id: string, qty: number) {
    const c = { ...cart };
    if (qty <= 0) delete c[id]; else c[id] = Math.min(20, qty);
    setCart(c);
    writeCart(c);
  }

  const lines = books.filter((b) => cart[b.id]).map((b) => ({ ...b, qty: cart[b.id] }));
  const total = lines.reduce((n, l) => n + l.price_inr * l.qty, 0);

  async function checkout() {
    if (!window.Razorpay) { alert("Payment library is still loading — please try again in a moment."); return; }
    setBusy(true);
    setProblems([]);
    try {
      const res = await createCartOrder({
        items: lines.map((l) => ({ bookId: l.id, qty: l.qty })),
        buyer: { email, shipping, billing, sameAsShipping, gstin },
      });
      if (!res.ok) {
        // NAME THE EMPTY BOX. "Please fill in all the required details" leaves
        // the buyer hunting; the server knows exactly which field it refused.
        if (res.reason === "invalid") { setProblems(res.missing ?? ["some required details"]); return; }
        else if (res.reason === "oos") alert(`Sorry, ${res.title ?? "a title in your cart"} just went out of stock.`);
        else if (res.reason === "unconfigured") alert("Online ordering is being set up — please contact us and we'll arrange your order.");
        else alert("Could not start checkout. Please try again or contact us.");
        return;
      }
      const rzp = new window.Razorpay({
        key: res.keyId, amount: res.amount, currency: "INR", name: res.name, description: res.description,
        order_id: res.orderId, prefill: res.prefill, theme: { color: "#0d9488" },
        handler: async (resp) => {
          const v = await verifyCartPayment(resp);
          if (v.ok) { writeCart({}); setDone(true); }
          else alert("Payment received but verification failed — please contact us with your payment id.");
        },
      });
      rzp.open();
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "30px auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.2rem" }}>🎉</div>
        <h2>Order placed!</h2>
        <p className="muted">Thank you! Your books are on their way with free shipping 🚚. A confirmation email is on its way too.</p>
        <Link className="btn" href="/books" style={{ marginTop: 8 }}>← Back to the book store</Link>
      </div>
    );
  }

  if (loaded && lines.length === 0) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "30px auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.2rem" }}>🛒</div>
        <h2>Your cart is empty</h2>
        <Link className="btn" href="/books" style={{ marginTop: 8 }}>📦 Browse books →</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />

      {/* Items */}
      <div style={{ display: "grid", gap: 10 }}>
        {lines.map((l) => (
          <div key={l.id} className="list-row">
            {l.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightImg(l.cover_url, 128)} alt={l.title} style={{ width: 52, height: 68, objectFit: "cover", borderRadius: 8 }} />
            ) : (
              <span style={{ fontSize: "1.6rem" }}>📘</span>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="row-title">{l.title}</span>
              <p className="row-sub">₹{l.price_inr.toLocaleString("en-IN")} each</p>
            </div>
            <div className="row-actions" style={{ alignItems: "center", gap: 6 }}>
              <button className="btn small secondary" type="button" onClick={() => setQty(l.id, l.qty - 1)}>−</button>
              <strong style={{ minWidth: 24, textAlign: "center" }}>{l.qty}</strong>
              <button className="btn small secondary" type="button" onClick={() => setQty(l.id, l.qty + 1)}>+</button>
              <strong style={{ minWidth: 90, textAlign: "right" }}>₹{(l.price_inr * l.qty).toLocaleString("en-IN")}</strong>
              <button className="btn small secondary" type="button" onClick={() => setQty(l.id, 0)} title="Remove">🗑</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 4px" }}>
        <Link href="/books" style={{ color: "var(--accent)", fontWeight: 700 }}>← Add more books</Link>
        <div style={{ fontSize: "1.25rem", fontWeight: 800 }}>Total: ₹{total.toLocaleString("en-IN")} <span className="muted" style={{ fontSize: ".8rem", fontWeight: 500 }}>· incl. GST · free shipping 🚚</span></div>
      </div>

      {/* Delivery details */}
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>🚚 Delivery address</h3>
        <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 12px" }}>
          Where the parcel goes.{onFile?.signedIn ? " Filled in from your profile — change anything that has moved." : ""}
        </p>
        <label style={{ margin: "0 0 10px" }}>
          Email <span className="muted" style={{ fontWeight: 400 }}>(the invoice and tracking go here)</span>
          <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <AddressFields idPrefix="ship" value={shipping} onChange={setShipping} />

        {/* HIS RULE: TELL THEM, DO NOT OVERWRITE. A profile address that
            differs is worth saying out loud — people move, and people also
            send one order to a parent's house. Neither is an error. */}
        {shipDiff.length > 0 && (
          <p style={{ fontSize: ".8rem", margin: "0 0 10px", color: "#b45309" }}>
            Your profile has a different address on file ({shipDiff.join(", ")}). This order will go to what is typed
            above, and your profile will be updated to match.
          </p>
        )}

        <h3 style={{ margin: "18px 0 4px" }}>🧾 Billing address</h3>
        <label className="remember" style={{ display: "inline-flex", gap: 7, alignItems: "center", margin: "0 0 10px", fontWeight: 600 }}>
          <input type="checkbox" checked={sameAsShipping} onChange={(e) => setSameAsShipping(e.target.checked)} />
          Same as the delivery address
        </label>
        {!sameAsShipping && (
          <>
            <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
              Who the invoice is made out to. For a sponsored order this is the sponsor or the firm, while the books
              still go to the student above.
            </p>
            <AddressFields idPrefix="bill" value={billing} onChange={setBilling} requirePhone={false} showLandmark={false} />
            {billDiff.length > 0 && (
              <p style={{ fontSize: ".8rem", margin: "0 0 10px", color: "#b45309" }}>
                Your profile has a different billing address on file ({billDiff.join(", ")}). The invoice will use what
                is typed above.
              </p>
            )}
          </>
        )}

        <GstinField value={gstin} onChange={setGstin} fromProfile={!!onFile?.hasProfileGstin} />

        {problems.length > 0 && (
          <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, background: "rgba(185,28,28,.08)" }}>
            <strong style={{ fontSize: ".84rem", color: "#b91c1c" }}>Still needed before we can take the payment:</strong>
            <ul style={{ margin: "5px 0 0 18px", fontSize: ".82rem", color: "#b91c1c" }}>
              {problems.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}

        <button className="btn block" type="button" disabled={busy || !configured || total <= 0} onClick={checkout} style={{ marginTop: 10 }}>
          {busy ? "Starting…" : `🔒 Pay ₹${total.toLocaleString("en-IN")} & place order →`}
        </button>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 10, textAlign: "center" }}>
          🔒 Secure checkout by Razorpay · 🚚 Free shipping across India · No account needed
        </p>
      </div>
    </div>
  );
}
