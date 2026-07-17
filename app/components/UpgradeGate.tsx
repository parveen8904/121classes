import Link from "next/link";

// Shown when a free student has used up a metered allowance (MCQ / descriptive
// / case attempts). A friendly "you've used your free tries → Enroll" screen.
export default function UpgradeGate({
  title,
  used,
  limit,
  plansHref,
  backHref,
  backLabel = "← Back",
}: {
  title: string;
  used: number;
  limit: number;
  plansHref: string;
  backHref: string;
  backLabel?: string;
}) {
  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 560 }}>
        <p className="crumb"><Link href={backHref}>{backLabel}</Link></p>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2.4rem" }}>🔒</div>
          <h1 style={{ fontSize: "1.4rem", margin: "6px 0 8px" }}>You&apos;ve used your free {title}</h1>
          <p className="muted" style={{ fontSize: ".95rem" }}>
            The free plan includes <strong>{limit}</strong> {title}
            {used >= limit ? " — and you've used them all." : "."} Enroll in Silver or Gold for unlimited access.
          </p>
          <Link className="btn" href={plansHref} style={{ marginTop: 10 }}>Enroll now →</Link>
        </div>
      </section>
    </main>
  );
}
