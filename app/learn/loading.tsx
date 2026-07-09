// Instant feedback while any learn page (course/topic/class) loads — the tap
// responds immediately instead of appearing frozen.
export default function Loading() {
  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: "2rem" }} className="pulse-soft">📖</div>
          <p className="muted" style={{ marginTop: 10 }}>Opening…</p>
        </div>
        <style>{`.pulse-soft { animation: pulseSoft 1s ease-in-out infinite; } @keyframes pulseSoft { 0%,100% { opacity: .4 } 50% { opacity: 1 } }`}</style>
      </section>
    </main>
  );
}
