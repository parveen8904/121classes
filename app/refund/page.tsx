import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";

export const metadata = { title: "Refund Policy — 121 CA Classes" };

export default function Refund() {
  return (
    <main>
      <SiteNav />
      <article className="legal">
        <h1>Refund Policy</h1>
        <p className="muted">Last updated: June 2026 · Placeholder — set your final terms before launch.</p>

        <h2>1. Digital subscriptions</h2>
        <p>Subscriptions to courses (Bronze / Silver / Gold) grant access to digital content
          for the chosen duration. Because content is accessible immediately, subscription
          fees are generally non-refundable once access has been used.</p>

        <h2>2. Cancellations</h2>
        <p>You may cancel auto-renewal at any time from your account. Cancelling stops future
          renewals; access continues until the end of the paid period.</p>

        <h2>3. Books</h2>
        <p>Physical books may be returned if they arrive damaged or defective. Contact us
          within 7 days of delivery with your order details and photos.</p>

        <h2>4. Exceptions</h2>
        <p>Refund requests due to duplicate payments or technical errors will be reviewed and,
          where valid, processed to the original payment method.</p>

        <h2>5. Contact</h2>
        <p>For refund requests, email ps.smay@gmail.com with your order or account details.</p>
      </article>
      <SiteFooter />
    </main>
  );
}
