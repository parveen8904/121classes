import LandingForm from "./LandingForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Free CA Study Planner — CA Parveen Sharma",
  description: "Get a free day-by-day study plan for your CA attempt — built around your exam date, with revision rounds and chapter tests. By CA Parveen Sharma.",
};

// Lead-capture landing page for YouTube / WhatsApp / Instagram traffic.
// Share as /free-planner?src=yt (or wa / ig / tg) — the source flows into the
// insights page so every platform's real conversion is visible.
export default async function FreePlannerLanding(props: { searchParams: Promise<{ src?: string }> }) {
  const searchParams = await props.searchParams;
  const src = (searchParams.src ?? "").slice(0, 20);

  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 920 }}>
        <div style={{ display: "grid", gap: 32, gridTemplateColumns: "1.1fr 1fr", alignItems: "start" }} className="landing-split">
          <div>
            <span className="badge">📅 Free for every CA student</span>
            <h1 style={{ marginTop: 12, lineHeight: 1.15 }}>
              Your day-by-day CA study plan — built in 2 minutes, free
            </h1>
            <p className="meta" style={{ marginTop: 12, fontSize: "1.02rem" }}>
              Tell us your exam attempt and how many hours you can study — the planner maps every day
              from today to your exam: classes, revision rounds and practice, subject by subject.
            </p>
            <ul style={{ marginTop: 18, display: "grid", gap: 10, listStyle: "none", padding: 0 }}>
              <li>✅ <strong>Day-by-day schedule</strong> backwards from your exam date</li>
              <li>✅ <strong>Revision rounds built in</strong> — first &amp; second revision, not just one pass</li>
              <li>✅ <strong>Free chapter MCQ tests</strong> with rank &amp; concept report</li>
              <li>✅ <strong>Case-study practice</strong> for the new pattern</li>
              <li>✅ Learn from <strong>CA Parveen Sharma</strong> — 36 years of teaching experience</li>
            </ul>
            <p className="muted" style={{ fontSize: ".8rem", marginTop: 16 }}>
              Join the students already planning their attempt on caparveensharma.com
            </p>
          </div>
          <div className="form-card" style={{ position: "sticky", top: 20 }}>
            <h3 style={{ marginTop: 0 }}>Get your free plan</h3>
            <LandingForm src={src} />
          </div>
        </div>
      </section>
      <style>{`@media (max-width: 760px) { .landing-split { grid-template-columns: 1fr !important; } }`}</style>
    </main>
  );
}
