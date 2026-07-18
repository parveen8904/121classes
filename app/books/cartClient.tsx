"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Cart lives in localStorage so guests can shop without an account:
// { [bookId]: qty }. Components sync via a window event.
const KEY = "bookCart";
const EVENT = "book-cart-changed";

export function readCart(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function writeCart(cart: Record<string, number>) {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}
export function cartCount(): number {
  return Object.values(readCart()).reduce((n, q) => n + q, 0);
}

export function AddToCartButton({ bookId, inStock }: { bookId: string; inStock: boolean }) {
  const [added, setAdded] = useState(false);
  if (!inStock) return <span className="muted" style={{ fontSize: ".8rem" }}>⏳ Out of stock</span>;
  return (
    <button
      className="btn small"
      type="button"
      onClick={() => {
        const cart = readCart();
        cart[bookId] = (cart[bookId] ?? 0) + 1;
        writeCart(cart);
        setAdded(true);
        setTimeout(() => setAdded(false), 1500);
      }}
    >
      {added ? "✓ Added" : "🛒 Add to cart"}
    </button>
  );
}

// Floating cart pill — shows on the store; hidden when the cart is empty.
export function CartBar() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(cartCount());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener("storage", update); };
  }, []);
  if (count === 0) return null;
  return (
    <Link
      href="/books/cart"
      style={{
        position: "fixed", right: 18, bottom: 90, zIndex: 60,
        background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
        color: "#fff", fontWeight: 800, borderRadius: 999, padding: "12px 20px",
        boxShadow: "0 6px 20px rgba(0,0,0,.25)",
      }}
    >
      🛒 Cart · {count} → Checkout
    </Link>
  );
}
