import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";

export const metadata = { title: "Refund Policy — 121 CA Classes" };

export default function Refund() {
  return (
    <main>
      <SiteNav />
      <article className="legal">
        <h1>Refund &amp; Cancellation Policy</h1>
        <p className="muted">Last updated: 14 June 2026</p>

        <p>
          This policy applies to all purchases made on <strong>121 CA Classes</strong> (a venture of
          CA Parveen Sharma). Please read it carefully before subscribing or ordering.
        </p>

        <h2>1. Digital subscriptions</h2>
        <p>
          Subscriptions to courses (Bronze / Silver / Gold) grant immediate access to digital content
          for the chosen validity period. Because the content is delivered and accessible instantly,
          subscription fees are <strong>non-refundable once access has been availed</strong>, except
          as required by law or as set out below.
        </p>

        <h2>2. Cancellation of renewal</h2>
        <p>
          Where a subscription is set to auto-renew, you may cancel future renewals at any time from
          your account. Cancellation stops further billing; your existing access continues until the
          end of the period already paid for.
        </p>

        <h2>3. Physical books</h2>
        <p>
          Physical books may be returned if they arrive <strong>damaged or defective</strong>, or if
          an incorrect item is delivered. Please contact us within <strong>7 days of delivery</strong>{" "}
          with your order number and clear photographs. Approved returns are replaced, or refunded to
          the original payment method.
        </p>

        <h2>4. Duplicate or failed payments</h2>
        <p>
          If you are charged more than once for the same order, or money is debited without access
          being granted, the excess or erroneous amount will be refunded in full to the original
          payment method after verification.
        </p>

        <h2>5. How refunds are processed</h2>
        <p>
          Approved refunds are processed through our payment partner (Razorpay) to the original
          payment method. Refunds are typically completed within <strong>7&ndash;10 business days</strong>,
          subject to your bank or card issuer&rsquo;s timelines.
        </p>

        <h2>6. How to request a refund</h2>
        <p>
          Email <a className="grad" href="mailto:contact@caparveensharma.com">contact@caparveensharma.com</a> with
          your registered name, order or account details, and the reason for your request. We aim to
          respond within 3 business days.
        </p>

        <p className="muted" style={{ marginTop: 24, fontSize: ".82rem" }}>
          This document is provided for general information. We recommend a final review by a legal
          professional before relying on it.
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
