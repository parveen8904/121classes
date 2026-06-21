import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Entry = { iso: string; date: string; label: string; mock?: boolean };

// "Today's target" — what the student should do today, pulled from the plan they
// built in the planner. No plan yet → a prominent nudge to build one.
export default async function TodayPlan() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: plan } = await supabase.from("study_plans").select("schedule").eq("user_id", user.id).maybeSingle();
  const schedule = (plan?.schedule as Entry[]) ?? [];

  const cardStyle = {
    marginTop: 18,
    borderRadius: 16,
    border: "2px solid var(--accent)",
    background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, transparent), var(--bg-soft))",
    padding: "18px 20px",
  } as const;

  const heading = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: "1.5rem" }}>🎯</span>
      <strong style={{ fontSize: "1.25rem" }}>Today&apos;s target</strong>
    </div>
  );

  // No plan yet → prominent build-your-plan nudge.
  if (!schedule.length) {
    return (
      <div className="card" style={cardStyle}>
        {heading}
        <p className="muted" style={{ fontSize: ".9rem", margin: "8px 0 12px" }}>
          ✨ You haven&apos;t built your plan yet. Set your exam date &amp; daily study hours, and we&apos;ll tell you exactly what to do each day. 🚀
        </p>
        <Link className="btn" href="/planner">🛠️ Build your plan →</Link>
      </div>
    );
  }

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todays = schedule.filter((e) => e.iso === today);

  return (
    <div className="card" style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {heading}
        <Link href="/planner" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".85rem" }}>📅 Full plan →</Link>
      </div>
      {todays.length ? (
        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          {todays.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: e.mock ? 800 : 500 }}>
              <span>{e.mock ? "📝" : "✅"}</span>
              <span>{e.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: ".95rem", marginTop: 12, fontWeight: 600 }}>🎉 Nothing scheduled today — enjoy the break or get ahead!</p>
      )}
    </div>
  );
}
