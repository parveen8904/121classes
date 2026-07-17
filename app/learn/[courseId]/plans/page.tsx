import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { razorpayConfigured } from "@/lib/razorpay";
import PricingCards from "./PricingCards";
import { ACCESS_CATEGORIES, getAllLimits, limitFor } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

export default async function CoursePlans(
  props: {
    params: Promise<{ courseId: string }>;
    searchParams: Promise<{ subject?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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

  // Subjects of this course (each carries its own Gold price + validity), the
  // flat Silver price, and the student's existing access for this course.
  const [{ data: subjects }, { data: silverPlan }, { data: subs }, { data: validitySetting }] =
    await Promise.all([
      supabase
        .from("subjects")
        .select("id, title, gold_price_inr, validity_months, subject_faculty(faculties(full_name))")
        .eq("course_id", course.id)
        .order("order_index"),
      supabase
        .from("plans")
        .select("web_price_inr")
        .eq("tier", "silver")
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("subscriptions")
        .select("subject_id, plans(tier, rank)")
        .eq("student_id", user.id)
        .eq("course_id", course.id)
        .eq("status", "active"),
      supabase.from("site_settings").select("value").eq("key", "gold_validity_options").maybeSingle(),
    ]);

  const goldValidityOptions = ((validitySetting?.value as string) ?? "1,2,3,6,12,18,24")
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const subjectList = subjects ?? [];
  if (subjectList.length === 0) {
    return (
      <main>
        <section className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
          <p className="crumb">
            <Link href={`/learn/${course.id}`}>← {course.title}</Link>
          </p>
          <p className="muted" style={{ textAlign: "center", marginTop: 30 }}>
            Subjects are being set up. Please check back shortly.
          </p>
        </section>
      </main>
    );
  }

  const selected =
    subjectList.find((s) => s.id === searchParams.subject) ?? subjectList[0];

  // Highest active tier the student already has for the selected subject
  // (a whole-course subscription has subject_id = null and covers everything).
  let currentTier: string | null = null;
  let currentRank = 0;
  for (const row of subs ?? []) {
    const r = row as { subject_id: string | null; plans?: { tier?: string; rank?: number } | null };
    const covers = r.subject_id === null || r.subject_id === selected.id;
    const rank = r.plans?.rank ?? 0;
    if (covers && rank > currentRank) {
      currentRank = rank;
      currentTier = r.plans?.tier ?? null;
    }
  }

  const facultyNames = ((selected as {
    subject_faculty?: { faculties?: { full_name?: string } | null }[];
  }).subject_faculty ?? [])
    .map((sf) => sf.faculties?.full_name)
    .filter(Boolean)
    .join(", ");

  const razorpayOn = await razorpayConfigured();

  // Build the "Free includes" chips from the admin limits matrix.
  const limitsMap = await getAllLimits();
  const freeIncludes = ACCESS_CATEGORIES.map((c) => {
    const lim = limitFor(limitsMap, "free", c.key);
    if (lim === 0) return null;                        // locked → not listed
    const name = c.label.replace(/^[^A-Za-z]+/, "").trim(); // drop leading emoji
    return lim < 0 ? `${name}: unlimited` : `${lim} ${name}`;
  }).filter(Boolean) as string[];

  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
        <p className="crumb">
          <Link href={`/learn/${course.id}`}>← {course.title}</Link>
        </p>

        {/* Inside the iOS/Android app: no purchases (App Store rules) — plans are managed on the website. */}
        <div className="show-in-app card" style={{ maxWidth: 560, margin: "20px auto", textAlign: "center" }}>
          <div style={{ fontSize: "2rem" }}>🔐</div>
          <h2 style={{ margin: "8px 0" }}>Plans are managed on the website</h2>
          <p className="muted">Plans and upgrades for your account are handled at caparveensharma.com in a web browser — not inside this app. Once your plan is active, everything unlocks here automatically.</p>
        </div>

        <div className="hide-in-app">
        <div style={{ textAlign: "center", maxWidth: 660, margin: "0 auto 18px" }}>
          <span className="badge">{course.title}</span>
          <h1 style={{ margin: "14px 0 8px", fontSize: "clamp(1.8rem,4vw,2.6rem)" }}>
            Choose a subject &amp; plan
          </h1>
          <p className="muted">
            Each subject is priced on its own. Bronze is free, Silver adds tests &amp; AI doubt-solving,
            and Gold unlocks the full premium classes with CA Parveen Sharma&apos;s team.
          </p>
          <p style={{ marginTop: 8 }}>
            💚 Need help affording Gold? <Link className="grad" href="/scholarship" style={{ fontWeight: 700 }}>Apply for a merit or need-based discount →</Link>
          </p>
        </div>

        {/* Subject picker */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", margin: "0 auto 26px", maxWidth: 900 }}>
          {subjectList.map((s) => {
            const active = s.id === selected.id;
            return (
              <Link
                key={s.id}
                href={`/learn/${course.id}/plans?subject=${s.id}`}
                style={{
                  borderRadius: 999,
                  padding: "9px 16px",
                  fontWeight: 600,
                  fontSize: ".88rem",
                  border: "1px solid var(--border)",
                  background: active ? "linear-gradient(90deg, var(--accent), var(--accent-2))" : "var(--bg-soft)",
                  color: active ? "#fff" : "var(--muted)",
                }}
              >
                {s.title}
              </Link>
            );
          })}
        </div>

        <PricingCards
          subject={{
            id: selected.id,
            title: selected.title,
            gold_price_inr: selected.gold_price_inr,
            validity_months: selected.validity_months ?? 12,
          }}
          facultyNames={facultyNames}
          silverPrice={silverPlan?.web_price_inr ?? null}
          goldValidityOptions={goldValidityOptions}
          currentTier={currentTier}
          courseId={course.id}
          configured={razorpayOn}
          contactHref="/#contact"
        />
        </div>

        {/* What the FREE plan includes (from the admin access-limits matrix). */}
        <div className="card" style={{ maxWidth: 640, margin: "24px auto 0" }}>
          <strong>🆓 Free plan includes</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {freeIncludes.map((f) => (
              <span key={f} style={{ background: "var(--bg-soft)", borderRadius: 999, padding: "4px 12px", fontSize: ".84rem" }}>{f}</span>
            ))}
          </div>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 8, marginBottom: 0 }}>
            A one-time free trial. Upgrade to Silver or Gold for unlimited access.
          </p>
        </div>
      </section>
    </main>
  );
}
