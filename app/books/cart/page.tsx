import { razorpayConfigured } from "@/lib/razorpay";
import CartCheckout from "./CartCheckout";

export const dynamic = "force-dynamic";
export const metadata = {
  // A cart belongs to whoever filled it.
  robots: { index: false, follow: true },
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/books/cart" }, title: "Your cart — Books by CA Parveen Sharma" };

export default async function CartPage() {
  const configured = await razorpayConfigured();
  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">🛒 Your cart</span>
        <h2>Review &amp; checkout</h2>
        <p>Pay once for all your books — free shipping across India 🚚</p>
      </div>
      <CartCheckout configured={configured} />
    </section>
  );
}
