"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { getCartBooks, createCartOrder, verifyCartPayment, type CartBook } from "../cartActions";
import { readCart, writeCart } from "../cartClient";
import { lightImg } from "@/lib/img";

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
  const [form, setForm] = useState({ name: "", email: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const c = readCart();
    setCart(c);
    const ids = Object.keys(c);
    if (!ids.length) { setLoaded(true); return; }
    getCartBooks(ids).then((bs) => { setBooks(bs); setLoaded(true); });
  }, []);

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
    try {
      const res = await createCartOrder({ items: lines.map((l) => ({ bookId: l.id, qty: l.qty })), buyer: form });
      if (!res.ok) {
        if (res.reason === "invalid") alert("Please fill in all the required delivery details.");
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
        <h3 style={{ marginBottom: 14 }}>🚚 Delivery details</h3>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Full name</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
          <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} required /></div>
        </div>
        <label>Email</label>
        <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        <label>Address line 1</label>
        <input value={form.line1} onChange={(e) => set("line1", e.target.value)} required />
        <label>Address line 2</label>
        <input value={form.line2} onChange={(e) => set("line2", e.target.value)} />
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} required /></div>
          <div><label>State</label><input value={form.state} onChange={(e) => set("state", e.target.value)} /></div>
          <div><label>PIN code</label><input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} required /></div>
        </div>
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
