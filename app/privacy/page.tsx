import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";

export const metadata = { title: "Privacy Policy — 1:1 CA Classes" };

export default function Privacy() {
  return (
    <main>
      <SiteNav />
      <article className="legal">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: June 2026 · Placeholder — review with a legal advisor before launch.</p>

        <h2>1. Information we collect</h2>
        <p>We collect the information you provide when you sign up (name, email, phone),
          your exam attempt, purchases, and activity within the platform (courses viewed,
          tests taken).</p>

        <h2>2. How we use it</h2>
        <p>To provide and personalize your learning, process payments, send updates via
          email and WhatsApp, fulfil book orders, and improve our services.</p>

        <h2>3. Sharing</h2>
        <p>We do not sell your data. We share it only with service providers that help us
          operate (payments, hosting, email, messaging) under appropriate safeguards.</p>

        <h2>4. Data security</h2>
        <p>We use industry-standard measures to protect your data. No method of transmission
          is fully secure, but we work to safeguard your information.</p>

        <h2>5. Your rights</h2>
        <p>You may request access to, correction of, or deletion of your personal data by
          contacting us.</p>

        <h2>6. Contact</h2>
        <p>For any privacy questions, email ps.smay@gmail.com.</p>
      </article>
      <SiteFooter />
    </main>
  );
}
