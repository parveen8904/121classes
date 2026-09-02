"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { createBookOrder, verifyBookPayment } from "./payActions";
import { myAddressBook } from "@/app/books/cartActions";
import AddressFields from "@/app/components/AddressFields";
import GstinField from "@/app/components/GstinField";
import { EMPTY_ADDRESS, addressDifferences, type Address } from "@/lib/address";

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

export default function BookCheckout({
  bookId,
  inStock,
  configured,
}: {
  bookId: string;
  inStock: boolean;
  configured: boolean;
}) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [shipping, setShipping] = useState<Address>(EMPTY_ADDRESS);
  const [billing, setBilling] = useState<Address>(EMPTY_ADDRESS);
  const [sameAsShipping, setSameAsShipping] = useState(true);
  const [gstin, setGstin] = useState("");
  const [onFile, setOnFile] = useState<{ shipping: Address; billing: Address; signedIn: boolean; hasProfileGstin: boolean } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  // Prefilled from the profile — the same address book the cart uses, so one
  // is never ahead of the other.
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

  if (!inStock) {
    return <p className="muted">⏳ This title is currently out of stock — please check back soon.</p>;
  }

  if (!configured) {
    return (
      <div className="card">
        <p className="muted">
          🛒 Online ordering is being set up. To order this book now, please{" "}
          <a href="/#contact" style={{ color: "var(--accent)" }}>
            contact us
          </a>{" "}
          and we&apos;ll arrange it. 🙌
        </p>
      </div>
    );
  }

  async function buy() {
    if (!window.Razorpay) {
      alert("Payment library is still loading — please try again in a moment.");
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      const res = await createBookOrder({ bookId, qty, buyer: { email, shipping, billing, sameAsShipping, gstin } });
      if (!res.ok) {
        if (res.reason === "invalid") { setProblems(res.missing ?? ["some required details"]); return; }
        else if (res.reason === "oos") alert("Sorry, this title just went out of stock.");
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
          const v = await verifyBookPayment(resp);
          if (v.ok) setDone(true);
          else alert("Payment received but verification failed — please contact us with your payment id.");
        },
      });
      rzp.open();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card">
        <h3>🎉 Order placed!</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          Thank you. Your book is on its way with free shipping 🚚. You&apos;ll get a confirmation by
          email.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <h3 style={{ marginBottom: 4 }}>🚚 Delivery address</h3>
      <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 12px" }}>
        Where the parcel goes.{onFile?.signedIn ? " Filled in from your profile — change anything that has moved." : ""}
      </p>
      <label style={{ margin: "0 0 10px" }}>
        Email <span className="muted" style={{ fontWeight: 400 }}>(the invoice and tracking go here)</span>
        <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
      </label>
      <AddressFields idPrefix="ship" value={shipping} onChange={setShipping} />
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
            Who the invoice is made out to. For a sponsored order this is the sponsor or the firm, while the book still
            goes to the student above.
          </p>
          <AddressFields idPrefix="bill" value={billing} onChange={setBilling} requirePhone={false} showLandmark={false} />
          {billDiff.length > 0 && (
            <p style={{ fontSize: ".8rem", margin: "0 0 10px", color: "#b45309" }}>
              Your profile has a different billing address on file ({billDiff.join(", ")}). The invoice will use what is
              typed above.
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

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 6 }}>
        <div style={{ width: 120 }}>
          <label>Quantity</label>
          <input
            type="number"
            min={1}
            max={20}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <button className="btn" type="button" disabled={busy} onClick={buy} style={{ marginTop: 8 }}>
          {busy ? "Starting…" : "Buy now →"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>
        🔒 Secure checkout by Razorpay · 🚚 Free shipping across India
      </p>
    </div>
  );
}
