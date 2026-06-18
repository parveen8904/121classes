import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import Planner, { type PlanItem } from "./Planner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Study Planner — 121 CA Classes" };

export default async function PlannerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/planner");

  const { data: prof } = await supabase.from("profiles").select("target_attempt").eq("id", user.id).maybeSingle();
  const targetAttempt = String(prof?.target_attempt || "").replace(/_/g, " ");

  const { data: plan } = await supabase.from("study_plans").select("setup, schedule, remind").eq("user_id", user.id).maybeSingle();
  const initial = plan ? { setup: plan.setup, schedule: plan.schedule, remind: plan.remind } : null;

  const { data: cfgRow } = await supabase.from("site_settings").select("value").eq("key", "planner_config").maybeSingle();
  let config: Record<string, number> = {};
  try { config = JSON.parse((cfgRow?.value as string) || "{}"); } catch {}

  // Syllabus checklist for our students (published topics). Service client so it
  // works for logged-out visitors too.
  const { data: topics } = await createServiceClient()
    .from("topics")
    .select("id, title, order_index, subjects(title)")
    .eq("is_published", true)
    .order("order_index")
    .limit(400);

  const items: PlanItem[] = (topics ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    subject: (t as { subjects?: { title?: string } | null }).subjects?.title ?? "General",
  }));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <div className="learn-hero" style={{ marginBottom: 18 }}>
        <span className="badge">🗓️ Study Planner</span>
        <h1>Study planner &amp; diary</h1>
        <p className="meta">
          Tell us your exam date and how you&apos;re studying — we&apos;ll build a week-by-week plan with mock exams so you finish on time
          {targetAttempt ? ` for ${targetAttempt}` : ""}. ✍️
        </p>
      </div>
      <Planner items={items} signedIn={!!user} initial={initial as never} config={config as never} />
    </section>
  );
}
