import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PricingCards from "./PricingCards";

export const dynamic = "force-dynamic";

export default async function CoursePlans({ params }: { params: { courseId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/${params.courseId}/plans`);

  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", params.courseId)
    .single();
  if (!course) notFound();

  const [{ data: plans }, { data: sub }] = await Promise.all([
    supabase
      .from("plans")
      .select("id, tier, name, web_price_inr, rank")
      .eq("is_active", true)
      .order("rank"),
    supabase
      .from("subscriptions")
      .select("plans(tier)")
      .eq("student_id", user.id)
      .eq("course_id", course.id)
      .eq("status", "active")
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const currentTier =
    (sub as { plans?: { tier?: string } | null } | null)?.plans?.tier ?? null;

  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
        <p className="crumb">
          <Link href={`/learn/${course.id}`}>← {course.title}</Link>
        </p>

        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 10px" }}>
          <span className="badge">{course.title}</span>
          <h1 style={{ margin: "14px 0 8px", fontSize: "clamp(1.8rem,4vw,2.6rem)" }}>
            Choose the plan that fits your prep
          </h1>
          <p className="muted">
            One subscription per course. Upgrade any time — higher tiers unlock more of every topic,
            from revision videos to live classes with CA Parveen Sharma&apos;s team.
          </p>
        </div>

        {plans && plans.length > 0 ? (
          <PricingCards plans={plans} currentTier={currentTier} contactHref="/#contact" />
        ) : (
          <p className="muted" style={{ textAlign: "center", marginTop: 30 }}>
            Plans are being set up. Please check back shortly.
          </p>
        )}
      </section>
    </main>
  );
}
