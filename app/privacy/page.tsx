
export const metadata = { title: "Privacy Policy — CA Parveen Sharma" };

export default function Privacy() {
  return (
    <main>
      <article className="legal">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: 14 June 2026</p>

        <p>
          This Privacy Policy explains how <strong>CA Parveen Sharma</strong>, a venture of
          CA Parveen Sharma (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;), collects, uses,
          shares and protects your personal data when you use{" "}
          <a className="grad" href="https://caparveensharma.com">caparveensharma.com</a>, our mobile and
          desktop applications, and related services (together, the &ldquo;Platform&rdquo;). We are
          committed to handling your data in accordance with the Digital Personal Data Protection
          Act, 2023 and other applicable Indian law.
        </p>

        <h2>1. Information we collect</h2>
        <ul>
          <li><strong>Account details</strong> — name, email address, mobile number, target CA attempt, and password.</li>
          <li><strong>Payment information</strong> — processed securely by our payment partner (Razorpay). We do not store your full card or bank details.</li>
          <li><strong>Learning activity</strong> — courses and videos viewed, watch time, tests attempted, doubts asked, and submitted answer files.</li>
          <li><strong>Device &amp; session data</strong> — device type, app version, and a session identifier used to enforce our single-device login policy and to secure your account.</li>
          <li><strong>Communications</strong> — messages you send us by email, WhatsApp, Telegram or in-app.</li>
        </ul>

        <h2>2. How we use your data</h2>
        <ul>
          <li>To provide, personalise and improve your learning experience.</li>
          <li>To process subscriptions, book orders and payments.</li>
          <li>To evaluate submitted answers (including AI-assisted checking under faculty supervision) and generate your performance reports.</li>
          <li>To send you class reminders, updates, amendments and service messages via email, WhatsApp, Telegram and in-app notifications.</li>
          <li>To secure your account, prevent fraud and enforce our Terms.</li>
        </ul>

        <h2>3. Legal basis &amp; consent</h2>
        <p>
          We process your data on the basis of the consent you provide when you register and use the
          Platform, and to perform the services you have requested. You may withdraw consent at any
          time by contacting us, though some features may then become unavailable.
        </p>

        <h2>4. Sharing &amp; processors</h2>
        <p>
          We do not sell your personal data. We share it only with trusted service providers who
          process it on our behalf under appropriate safeguards — including payments (Razorpay),
          hosting and database (Supabase), content delivery (Bunny.net), email (Mailgun), messaging
          (WhatsApp/Interakt, Telegram) and AI-assisted features (Anthropic). These providers may
          process data outside India; where they do, we take steps to ensure it remains protected.
        </p>
        <p>
          <strong>AI features in detail.</strong> Some features (doubt answering, answer-sheet
          evaluation, the mock interview, study recommendations) send the content you submit — your
          typed question or answer, or the answer document you upload — to our AI provider
          (Anthropic) to generate a response. We do not send your name, email, phone number or any
          account identifier with these requests, and per Anthropic&apos;s API terms this content is
          not used to train AI models. Interactive AI features ask for your consent in the app
          before your first use, and every AI feature is optional — the Platform works without
          them.
        </p>

        <h2>5. Data retention</h2>
        <p>
          We keep your data for as long as your account is active and as needed to provide the
          Platform, comply with legal obligations, resolve disputes and enforce our agreements. You
          may request deletion of your account at any time.
        </p>

        <h2>6. Security</h2>
        <p>
          We use industry-standard measures to protect your data, including encryption of downloadable
          class content and per-student watermarking for traceability. No method of transmission or
          storage is fully secure, but we work continuously to safeguard your information.
        </p>

        <h2>7. Your rights</h2>
        <p>
          Subject to applicable law, you may request access to, correction of, or deletion of your
          personal data, and may withdraw consent or raise a grievance. To exercise these rights,
          contact our Grievance Officer below.
        </p>

        <h2>8. Children</h2>
        <p>
          The Platform is intended for CA aspirants. Where a user is a minor, we rely on consent
          provided by a parent or lawful guardian, and we do not knowingly use a child&rsquo;s data
          for any harmful purpose.
        </p>

        <h2>9. Cookies</h2>
        <p>
          We use essential cookies to keep you signed in and to remember your preferences (such as
          theme). We do not use cookies to sell your data.
        </p>

        <h2>10. Changes</h2>
        <p>
          We may update this Policy from time to time. Material changes will be notified on this page
          with a revised &ldquo;Last updated&rdquo; date.
        </p>

        <h2>11. Grievance Officer &amp; contact</h2>
        <p>
          <strong>CA Parveen Sharma</strong> (a venture of CA Parveen Sharma)<br />
          W6 Sector 24, DLF Phase 3, Gurugram, Haryana 122010, India<br />
          Email: <a className="grad" href="mailto:contact@caparveensharma.com">contact@caparveensharma.com</a>
        </p>

        <p className="muted" style={{ marginTop: 24, fontSize: ".82rem" }}>
          This document is provided for general information. We recommend a final review by a legal
          professional before relying on it for compliance.
        </p>
      </article>
    </main>
  );
}
