import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Entry = { iso: string; date: string; label: string; mock?: boolean };

// Today's items from the student's saved study plan, shown on the dashboard.
export default async function TodayPlan() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: plan } = await supabase.from("study_plans").select("schedule").eq("user_id", user.id).maybeSingle();
  const schedule = (plan?.schedule as Entry[]) ?? [];

  if (!schedule.length) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <strong>🗓️ No study plan yet</strong>
        <p className="muted" style={{ fontSize: ".88rem", margin: "4px 0 10px" }}>Build a day-by-day plan with your exam date and self-study hours.</p>
        <Link className="btn small" href="/planner">Build my plan →</Link>
      </div>
    );
  }

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todays = schedule.filter((e) => e.iso === today);

  return (
    <div className="card" style={{ marginTop: 18, borderColor: "var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>🗓️ Today&apos;s plan</strong>
        <Link href="/planner" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".85rem" }}>Full plan →</Link>
      </div>
      {todays.length ? (
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          {todays.map((e, i) => <span key={i} style={{ fontWeight: e.mock ? 700 : 400 }}>{e.label}</span>)}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: ".88rem", marginTop: 6 }}>Nothing scheduled today — enjoy the break or get ahead! 🎉</p>
      )}
    </div>
  );
}
