import Link from "next/link";

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <div className="logo">
          121<span>Coaching</span>
        </div>
        <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Link className="muted" href="/courses.html">
            Courses
          </Link>
          <Link className="btn" href="/login">
            Log in
          </Link>
        </nav>
      </header>

      <section className="container" style={{ padding: "80px 24px", textAlign: "center" }}>
        <span className="badge">121coaching.ai</span>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", margin: "20px 0 12px" }}>
          The 121 Coaching learning portal
        </h1>
        <p className="muted" style={{ maxWidth: 600, margin: "0 auto 28px" }}>
          Live classes, ad-free recorded lectures, downloadable notes, tests, and AI
          doubt-solving — personalized to your exam attempt.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="btn" href="/login">
            Log in / Sign up
          </Link>
          <Link className="btn secondary" href="/courses.html">
            Browse a sample topic
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 40, fontSize: ".85rem" }}>
          🚧 Phase 1 (Foundation): authentication + dashboards. Content, plans,
          payments, live classes and the book store arrive in later phases.
        </p>
      </section>
    </main>
  );
}
