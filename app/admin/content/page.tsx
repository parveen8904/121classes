import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { saveContent } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Career corner — Admin" };

export default async function ContentPage(props: { searchParams: Promise<{ saved?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("key, value").like("key", "career_%");
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string]));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero badge="🎓 Career corner" title="Career corner"
        subtitle="What students see in the Career Corner. Amendments → Admin → Amendments. Daily motivation is built in. Planner settings → Admin → Study planner."
        back={{ href: "/admin", label: "Admin" }} />

      {searchParams.saved === "1" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Saved.</div>}

      <form action={saveContent} className="form-card" style={{ marginTop: 18 }}>
        <h3>🎓 Career corner</h3>
        <label>Articleship guidance</label>
        <textarea name="career_articleship" rows={4} defaultValue={m.get("career_articleship") || ""} placeholder="How to find articleship, what to look for, CA firm guidance…" />
        <label>Placement &amp; interviews</label>
        <textarea name="career_placement" rows={4} defaultValue={m.get("career_placement") || ""} placeholder="Placement process, mock interview tips, CV pointers…" />
        <label>Career resources / links</label>
        <textarea name="career_resources" rows={3} defaultValue={m.get("career_resources") || ""} placeholder="Useful links, opportunities, community…" />
        <label>Job / articleship openings — one per line as <code>Title | Firm | Location | apply link or email</code></label>
        <textarea name="career_jobs" rows={5} defaultValue={m.get("career_jobs") || ""} placeholder={"CA Articleship | XYZ & Co | Gurugram | careers@xyz.com\nAudit Associate | ABC LLP | Delhi | https://abc.com/apply"} />
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>These are <strong>manual</strong> openings (in addition to the auto-aggregated jobs feed). Each shows on the Career page with an &ldquo;Apply&rdquo; button.</p>

        <label style={{ marginTop: 12 }}>🔗 Browse-&amp;-apply links — one per line as <code>Label | URL</code> (blank = defaults)</label>
        <textarea name="career_links" rows={4} defaultValue={m.get("career_links") || ""} placeholder={"Naukri — CA jobs | https://www.naukri.com/chartered-accountant-jobs\nXYZ & Co (walk-in) | https://xyz.com/careers"} />

        <label style={{ marginTop: 12 }}>📍 Cities for the &ldquo;CA jobs by city&rdquo; filter (comma-separated; blank = default list)</label>
        <input name="career_cities" defaultValue={m.get("career_cities") || ""} placeholder="Delhi, Gurgaon, Mumbai, Pune, Bengaluru, Hyderabad, Chennai, Kolkata" />

        <SubmitButton className="btn" style={{ marginTop: 12 }}>Save career corner</SubmitButton>
      </form>
    </section>
  );
}
