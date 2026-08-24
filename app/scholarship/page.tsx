import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import SecureFileInput from "@/app/components/SecureFileInput";
import { submitScholarship } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/scholarship" },
  title: "Scholarships & fee discounts — CA Parveen Sharma",
  description:
    "Merit discount of 15% for students scoring 55% or more in the last 12 months, and a 10% need-based discount for students from a financially weaker background. How to apply.",
};

export default async function ScholarshipPage(props: { searchParams: Promise<{ done?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  // THE OFFER IS PUBLIC; APPLYING STILL NEEDS AN ACCOUNT.
  //
  // This page used to bounce a signed-out visitor to /login, which meant a
  // student searching for help with the fees could never find that we give it —
  // Google reported the page as blocked, because the login it was sent to is
  // disallowed in robots.txt. The terms are now readable by anyone. The forms
  // are not: an application belongs to a student, so a visitor who is not signed
  // in is shown what the discounts are and asked to sign in to apply.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: mine } = user
    ? await createServiceClient()
        .from("scholarship_applications").select("kind, status, discount_percent, coupon_code, created_at")
        .eq("student_id", user.id).order("created_at", { ascending: false })
    : { data: null };
  const latest = (mine ?? [])[0];

  const SignInToApply = ({ what }: { what: string }) => (
    <p style={{ margin: "8px 0 0" }}>
      <Link className="btn" href={`/login?next=${encodeURIComponent("/scholarship")}`}>Sign in to apply</Link>
      <span className="muted" style={{ fontSize: ".82rem", marginLeft: 8 }}>
        {what} An application is tied to your own account, so it needs a login — signing up is free.
      </span>
    </p>
  );

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 640 }}>
        <div style={{ background: "linear-gradient(135deg,#0d9488,#10b981)", color: "#fff", borderRadius: 18, padding: "26px 24px" }}>
          <h1 style={{ color: "#fff", margin: 0 }}>💚 Need a little help to join?</h1>
          <p style={{ margin: "6px 0 0", opacity: .95 }}>We offer discounts on the Gold subscription for deserving and financially-needy students.</p>
        </div>

        {searchParams.done && <div className="notice ok" style={{ marginTop: 16 }}>✅ Application received! Our team will review it and email your discount coupon if approved.</div>}
        {searchParams.err === "merit" && <div className="notice err" style={{ marginTop: 16 }}>For the merit discount you need a marksheet from the last 12 months with 55% or more.</div>}
        {searchParams.err === "need" && <div className="notice err" style={{ marginTop: 16 }}>Please write a few lines about your situation (at least 20 characters).</div>}

        {latest && (
          <div className="card" style={{ marginTop: 16, borderLeft: "4px solid var(--accent)" }}>
            Your latest application ({latest.kind === "merit" ? "merit" : "need-based"}): <strong>{latest.status}</strong>
            {latest.status === "approved" && latest.coupon_code && <> — use coupon <strong>{latest.coupon_code}</strong> for {latest.discount_percent}% off at checkout.</>}
          </div>
        )}

        {/* Merit 15% */}
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>🎯 Merit discount — 15% off</h3>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: -4 }}>For students who scored <strong>55% or more</strong> in an exam within the <strong>last 12 months</strong>. Upload that marksheet.</p>
          {!user ? <SignInToApply what="You will be asked for the marksheet." /> : (
          <form action={submitScholarship} style={{ display: "grid", gap: 12 }}>
            <input type="hidden" name="kind" value="merit" />
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <div><label>Your % marks *</label><input name="marks_percent" type="number" step="0.01" min={0} max={100} required /></div>
              <div><label>Marksheet date *</label><input name="marksheet_date" type="date" required /></div>
            </div>
            <SecureFileInput name="marksheet_url" label="📄 Upload your marksheet (image/PDF)" required folder="scholarship" />
            <SubmitButton className="btn">Apply for 15% merit discount</SubmitButton>
          </form>)}
        </div>

        {/* Need 10% */}
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>🤲 Financial-need discount — 10% off</h3>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: -4 }}>For students from a financially weaker background. Tell us your situation in a few honest lines.</p>
          {!user ? <SignInToApply what="You will be asked to describe your situation." /> : (
          <form action={submitScholarship} style={{ display: "grid", gap: 12 }}>
            <input type="hidden" name="kind" value="need" />
            <textarea name="reason" rows={4} placeholder="Briefly describe your financial situation…" required />
            <SubmitButton className="btn secondary">Apply for 10% need-based discount</SubmitButton>
          </form>)}
        </div>
        <p style={{ marginTop: 14 }}><Link className="grad" href="/courses">← Back to courses</Link></p>
      </section>
    </main>
  );
}
