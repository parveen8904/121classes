import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";

export const metadata = { title: "Terms of Service — 121 CA Classes" };

export default function Terms() {
  return (
    <main>
      <SiteNav />
      <article className="legal">
        <h1>Terms of Service</h1>
        <p className="muted">Last updated: 14 June 2026</p>

        <p>
          These Terms govern your use of <strong>121 CA Classes</strong> (a venture of CA Parveen
          Sharma) — the website, mobile and desktop apps and all related services (the
          &ldquo;Platform&rdquo;). By registering or using the Platform, you agree to these Terms.
        </p>

        <h2>1. Eligibility &amp; account</h2>
        <p>
          You must provide accurate registration details and keep your password confidential. You are
          responsible for all activity under your account. To protect content, each account may be
          signed in on only <strong>one personal computer and one phone at a time</strong>; signing in
          elsewhere may end your other sessions.
        </p>

        <h2>2. Licence to use content</h2>
        <p>
          On payment of the applicable fee, we grant you a personal, non-transferable, non-exclusive
          licence to access the subscribed content for your own exam preparation during the validity
          period. You may download classes only through our official app for offline viewing within
          the Platform.
        </p>

        <h2>3. Prohibited use</h2>
        <p>
          You must not record, screen-capture, copy, re-upload, share, resell or distribute any class,
          note, test or other content, in whole or in part. Content is watermarked with your identity
          for traceability. Any piracy or sharing of credentials is a serious breach and may lead to
          immediate termination without refund and legal action.
        </p>

        <h2>4. Payments &amp; taxes</h2>
        <p>
          Prices are shown in Indian Rupees and are payable through our payment partner (Razorpay).
          Applicable taxes may be added. Subscriptions grant access for the stated validity only.
        </p>

        <h2>5. AI-assisted features</h2>
        <p>
          Teaching is delivered by CA Parveen Sharma and team. Certain features (answer checking and
          doubt-solving) are <strong>assisted by AI under faculty supervision</strong>. AI output is a
          study aid and may contain errors; it does not replace professional or examiner judgement.
        </p>

        <h2>6. No guarantee of results</h2>
        <p>
          We are committed to high-quality teaching, but we do not guarantee any particular examination
          result, rank or outcome, which depends on each student&rsquo;s own effort and other factors.
        </p>

        <h2>7. Intellectual property</h2>
        <p>
          All content, branding and materials on the Platform are owned by or licensed to 121 CA
          Classes and are protected by law. No rights are granted except the limited licence in
          clause 2.
        </p>

        <h2>8. Termination</h2>
        <p>
          We may suspend or terminate access for breach of these Terms, including content piracy or
          credential sharing. On termination for breach, no refund is due.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          The Platform is provided on an &ldquo;as is&rdquo; basis. To the extent permitted by law, our
          liability arising from your use of the Platform is limited to the amount you paid for the
          relevant subscription in the preceding 12 months.
        </p>

        <h2>10. Governing law</h2>
        <p>
          These Terms are governed by the laws of India. The courts at Gurugram, Haryana shall have
          exclusive jurisdiction.
        </p>

        <h2>11. Contact</h2>
        <p>
          <strong>121 CA Classes</strong> (a venture of CA Parveen Sharma)<br />
          W6 Sector 24, DLF Phase 3, Gurugram, Haryana 122010, India<br />
          Email: <a className="grad" href="mailto:mail@caparveensharma.com">mail@caparveensharma.com</a>
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
