import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Planner, { type PlanItem } from "./Planner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Study Planner — 121 CA Classes" };

export default async function PlannerPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/planner");

  const { data: prof } = await supabase.from("profiles").select("full_name, target_attempt").eq("id", user.id).maybeSingle();

  // The syllabus checklist: published topics, grouped by subject.
  const { data: topics } = await supabase
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
          Your full syllabus as a checklist, your own to-dos, and a daily diary — so you never fall behind
          {prof?.target_attempt ? ` for ${String(prof.target_attempt).replace(/_/g, " ")}` : ""}. ✍️
        </p>
      </div>
      <Planner items={items} />
    </section>
  );
}
