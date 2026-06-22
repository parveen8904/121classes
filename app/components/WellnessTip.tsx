import { MOTIVATION } from "@/lib/motivation";

// A daily motivational message — hardcoded (no admin), picked by the day of the
// year so it rotates daily. More motivation than wellness, per the founder.
export default function WellnessTip() {
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const msg = MOTIVATION[dayOfYear % MOTIVATION.length];

  return (
    <div className="card" style={{ marginTop: 18, borderColor: "var(--accent)" }}>
      <p style={{ margin: 0 }}>💪 <strong>Today&apos;s motivation:</strong> {msg}</p>
    </div>
  );
}
