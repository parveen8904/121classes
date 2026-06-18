import { createClient } from "@/lib/supabase/server";

const FALLBACK = [
  "Revise yesterday's topic for 15 minutes before starting anything new.",
  "Study in 50-minute blocks with a 10-minute break — your focus lasts longer.",
  "Attempt one full past question daily; speed comes from practice, not reading.",
  "Sleep 7 hours — memory consolidates at night, not in last-minute cramming.",
  "Write answers by hand sometimes — it's how the real exam feels.",
  "Take a 10-minute walk between study sessions to reset your mind.",
];

// A rotating daily wellness/study tip (admin-managed in site_settings, else fallback).
export default async function WellnessTip() {
  const supabase = createClient();
  const { data } = await supabase.from("site_settings").select("value").eq("key", "wellness_tips").maybeSingle();
  const list = ((data?.value as string) || "")
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  const tips = list.length ? list : FALLBACK;
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const tip = tips[dayOfYear % tips.length];

  return (
    <div className="card" style={{ marginTop: 18, borderColor: "var(--accent)" }}>
      <p style={{ margin: 0 }}>🧘 <strong>Tip of the day:</strong> {tip}</p>
    </div>
  );
}
