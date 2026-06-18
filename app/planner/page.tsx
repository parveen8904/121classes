import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import Planner, { type PlanItem } from "./Planner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Study Planner — 121 CA Classes" };

// Public — anyone can build a plan, even if they're not our student yet.
export default async function PlannerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let targetAttempt = "";
  if (user) {
    const { data: prof } = await supabase.from("profiles").select("target_attempt").eq("id", user.id).maybeSingle();
    targetAttempt = String(prof?.target_attempt || "").replace(/_/g, " ");
  }

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
          {targetAttempt ? ` for ${targetAttempt}` : ""}. Anyone can use it. ✍️
        </p>
      </div>
      <Planner items={items} signedIn={!!user} />
    </section>
  );
}
