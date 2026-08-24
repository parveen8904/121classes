import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { saveCareerProfile } from "./actions";
import CareerUpload from "./CareerUpload";

export const dynamic = "force-dynamic";
export const metadata = {
  // One student's placement profile.
  robots: { index: false, follow: true },
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/career/profile" }, title: "My placement profile — CA Parveen Sharma" };

// THE STUDENT'S PLACEMENT PROFILE.
//
// Everything an employer asks for in the first mail, kept once: who they are,
// what stage they have reached, their resume and a photograph. The office sends
// chosen profiles to recruiters — but only where the student has ticked the
// consent box, because these are real people's papers leaving the building.
export default async function CareerProfilePage(props: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/career/profile");

  const svc = createServiceClient();
  const [{ data: p }, { data: prof }] = await Promise.all([
    svc.from("career_profiles").select("*").eq("student_id", user.id).maybeSingle(),
    svc.from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle(),
  ]);

  const v = (k: string) => String((p as Record<string, unknown> | null)?.[k] ?? "");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <span className="badge">💼 Placement profile</span>
      <h1 style={{ margin: "14px 0 6px" }}>Your profile for recruiters</h1>
      <p className="muted" style={{ lineHeight: 1.7 }}>
        Fill this once and keep it current. When a firm asks us for candidates, we send the profiles of students who
        have opted in — directly, with your resume attached.
      </p>

      {sp.saved && <div className="notice ok" style={{ marginTop: 12 }}>✅ Saved. Keep it updated as your results come.</div>}

      <form action={saveCareerProfile} className="card" style={{ marginTop: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Full name</label>
            <input name="full_name" required defaultValue={v("full_name") || String(prof?.full_name ?? "")} /></div>
          <div><label>Phone</label>
            <input name="phone" defaultValue={v("phone") || String(prof?.phone ?? "")} /></div>
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Email for recruiters</label>
            <input name="email" type="email" defaultValue={v("email") || String(prof?.email ?? "")} /></div>
          <div><label>City &amp; state</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input name="city" placeholder="City" defaultValue={v("city")} />
              <input name="state" placeholder="State" defaultValue={v("state")} />
            </div></div>
        </div>

        <div><label>CA qualification stage</label>
          <input name="qualification" placeholder="e.g. CA Final — Group 1 cleared (Nov 2025), Group 2 in May 2026" defaultValue={v("qualification")} /></div>
        <div><label>Educational qualifications</label>
          <textarea name="education" rows={3} placeholder="B.Com (Hons), Delhi University, 2023 — 82%…" defaultValue={v("education")} /></div>
        <div><label>Articleship</label>
          <textarea name="articleship" rows={3} placeholder="Firm, duration, the work you actually did — statutory audit, GST, tax audits…" defaultValue={v("articleship")} /></div>
        <div><label>Other experience</label>
          <textarea name="experience" rows={2} defaultValue={v("experience")} /></div>
        <div><label>Skills</label>
          <input name="skills" placeholder="Ind AS, Tally, Advanced Excel, GST returns…" defaultValue={v("skills")} /></div>
        <div><label>Preferred work locations</label>
          <input name="preferred_locations" placeholder="Delhi NCR, remote…" defaultValue={v("preferred_locations")} /></div>
        <div><label>About you (2–3 lines a recruiter will read first)</label>
          <textarea name="about" rows={3} defaultValue={v("about")} /></div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Resume (PDF)</label>
            <CareerUpload kind="resume" current={v("resume_url") || null} /></div>
          <div><label>Photograph</label>
            <CareerUpload kind="photo" current={v("photo_url") || null} /></div>
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: ".9rem", lineHeight: 1.6 }}>
          <input type="checkbox" name="share_consent" defaultChecked={Boolean((p as { share_consent?: boolean } | null)?.share_consent)} style={{ marginTop: 4 }} />
          <span>I agree that CA Parveen Sharma Classes may share this profile, my resume and my photograph with
          employers and recruiters for placement. <strong>Without this tick, nothing is ever sent.</strong></span>
        </label>

        <SubmitButton className="btn">💾 Save my profile</SubmitButton>
      </form>
    </section>
  );
}
