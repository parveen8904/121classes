import Link from "next/link";
import ProfileAddressBlock from "@/app/components/ProfileAddressBlock";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "@/app/components/SubmitButton";
import AttemptPicker from "@/app/components/AttemptPicker";
import CourseSubjectsPicker from "./CourseSubjectsPicker";
import { updateProfile } from "./actions";
import { isPastAttempt } from "@/lib/attempts";

export const dynamic = "force-dynamic";

export default async function ProfilePage(props: { searchParams: Promise<{ saved?: string; need?: string; next?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/profile");

  const { data: p } = await supabase
    .from("profiles")
    .select(
      "full_name, phone, target_attempt, address_line1, address_line2, city, state, country, pincode, gstin, business_name, trade_name",
    )
    .eq("id", user.id)
    .single();

  // The student's course (level). Subjects are chosen on the dashboard.
  const [{ data: courses }, { data: myCourseRows }] = await Promise.all([
    supabase.from("courses").select("id, title").eq("is_published", true).order("order_index").order("title"),
    supabase.from("my_courses").select("course_id").eq("student_id", user.id),
  ]);
  const currentCourseId = (myCourseRows ?? [])[0]?.course_id ?? "";
  // Sent here from a checkout that could not proceed: the address is the whole
  // reason they are on this page, so it cannot be saved half-done.
  const needAddress = searchParams.need === "address";

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb">
          <Link prefetch={false} href="/dashboard">← Dashboard</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">👤 Your profile</span>
          <h1>Profile &amp; delivery details</h1>
          <p className="meta">
            We use this for your exam attempt, book deliveries and GST invoices. Email is your login
            ({user.email ?? user.phone}).
          </p>
        </div>

        {searchParams.saved && (
          <div className="notice ok" style={{ marginTop: 18 }}>
            Saved. Thank you!
          </div>
        )}

        {searchParams.need === "address" ? (
          <div className="notice" style={{ marginTop: 18, background: "rgba(234,179,8,0.14)", border: "2px solid #eab308", color: "var(--text)" }}>
            🧾 <strong>We need your billing address before we can take the payment.</strong> Every payment raises a
            GST invoice, and the invoice must carry your address and your state — the state is what decides the tax
            on it. Fill in address, city, state and PIN code below and tap <strong>Save profile</strong>; you will be
            taken straight back to finish paying. (If your plan includes printed books, this is where they are sent.)
          </div>
        ) : searchParams.need && (
          <div className="notice" style={{ marginTop: 18, background: "rgba(234,179,8,0.14)", border: "2px solid #eab308", color: "var(--text)" }}>
            ⚠️ Both your <strong>target exam attempt</strong> and your <strong>course / level</strong> are required. Please set them below, then tap <strong>Save profile</strong>. We use these to tailor your classes, amendments, study plan and tests to your attempt.
          </div>
        )}

        {/* AN ATTEMPT THAT HAS ALREADY BEEN SAT IS AS WRONG AS A MISSING ONE.
            Only an EMPTY attempt was ever checked, so on 1 September 2026 there
            were 242 students still set to "September 2026" — planner counting
            down to a date behind them, amendments filtered for a sitting that
            was over. This asks, and does not block: some of them have passed
            and some are re-sitting, and only they know which. */}
        {isPastAttempt(p?.target_attempt) && (
          <div className="notice" style={{ marginTop: 18, background: "rgba(234,179,8,0.14)", border: "2px solid #eab308", color: "var(--text)" }}>
            📅 Your target attempt is set to <strong>{p?.target_attempt}</strong>, which has now been sat.
            If you are preparing for the next one, please update it below and tap <strong>Save profile</strong> —
            your study plan, amendments and tests all follow this date.
          </div>
        )}

        <form action={updateProfile} style={{ marginTop: 20 }}>
          {/* Where they were when we interrupted them. Carried through the save
              so a student sent here from a plan page lands back on that plan
              instead of on the dashboard, hunting for it again. */}
          <input type="hidden" name="next" value={searchParams.next ?? ""} />
          <div className="card">
            <h3 style={{ marginBottom: 14 }}>About you</h3>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label htmlFor="full_name">Full name</label>
                <input id="full_name" name="full_name" defaultValue={p?.full_name ?? ""} required />
              </div>
              <div>
                <label htmlFor="phone">Phone</label>
                <input id="phone" name="phone" defaultValue={p?.phone ?? ""} placeholder="10-digit mobile" />
              </div>
            </div>
            <div style={{ maxWidth: 360 }}>
              <label>Target exam attempt</label>
              <AttemptPicker name="target_attempt" defaultValue={p?.target_attempt ?? ""} />
              <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                The attempt you&apos;re preparing for — pick the month and year.
              </p>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 14 }}>Your course / level</h3>
            <CourseSubjectsPicker courses={courses ?? []} currentCourseId={currentCourseId} />
          </div>

          {/* BILLING ADDRESS, NOT "SHIPPING ADDRESS (FOR BOOKS)".
              Under the old heading a student buying three months — who gets no
              books — had every reason to skip the whole card. Nothing was
              required, so they could save it empty, be sent back to the plan,
              and meet exactly the same wall again. It is needed for every
              payment, because every payment raises a GST invoice.

              Required only when they were sent here to fill it in: someone who
              opened their profile to correct a phone number should not be made
              to type an address before they can save. */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 4 }}>Billing address</h3>
            <p className="muted" style={{ fontSize: ".85rem", marginBottom: 14 }}>
              Needed before any payment — your invoice is a GST invoice and must carry it. Printed books, where a
              plan includes them, are sent here too.
            </p>
            {/* The state is CHOSEN, not typed. It decides CGST+SGST against
                IGST and prints as the state code on the invoice — one student's
                came out reading "State Code:-" because this was a text box and
                he typed his PIN into it. Country India/Other keeps the form
                usable for students abroad, who have provinces, not states.
                Ravi's spec, 2 Sep 2026. */}
            <ProfileAddressBlock
              idPrefix="me"
              required={needAddress}
              initial={{
                address_line1: p?.address_line1, address_line2: p?.address_line2,
                city: p?.city, state: p?.state, pincode: p?.pincode, country: p?.country,
                gstin: p?.gstin, business_name: p?.business_name, trade_name: p?.trade_name,
              }}
            />
          </div>

          <SubmitButton className="btn" style={{ marginTop: 18 }}>
            Save profile
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
