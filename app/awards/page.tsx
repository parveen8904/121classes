import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SiteNav from "@/app/components/SiteNav";
import SiteFooter from "@/app/components/SiteFooter";
import SubmitButton from "@/app/components/SubmitButton";
import SecureFileInput from "@/app/components/SecureFileInput";
import { submitAward } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tell us your result & get an award — CA Parveen Sharma" };

export default async function AwardsPage({ searchParams }: { searchParams: { done?: string; err?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/awards");

  return (
    <main>
      <SiteNav />
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 640 }}>
        <div style={{ background: "linear-gradient(135deg,#0d9488,#10b981)", color: "#fff", borderRadius: 18, padding: "28px 26px" }}>
          <h1 style={{ color: "#fff", margin: 0 }}>🏆 Tell us your result — get an award</h1>
          <p style={{ margin: "6px 0 0", opacity: .95 }}>Studied with CA Parveen Sharma and cleared your exam or scored well? Share your result and we&apos;ll send you an award. 🎉</p>
        </div>

        {searchParams.done && <div className="notice ok" style={{ marginTop: 16 }}>🎉 Thank you! Your result has been received. Our team will verify it and reach out about your award.</div>}
        {searchParams.err && <div className="notice err" style={{ marginTop: 16 }}>Please fill your name, phone, what you achieved, and tick the confirmation.</div>}

        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
            ✅ Eligibility: you must have studied using our resources (classes/notes/tests). Upload your marksheet and a photo so we can verify and celebrate your success.
          </p>
          <form action={submitAward} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <div><label>Your name *</label><input name="name" required /></div>
              <div><label>Phone *</label><input name="phone" type="tel" required /></div>
            </div>
            <div><label>What did you achieve? * <span className="muted" style={{ fontSize: ".8rem" }}>(e.g. Cleared CA Final, AIR 42, 78/100 in FR)</span></label><input name="achievement" required /></div>
            <div><label>Marks / percentage (optional)</label><input name="marks" placeholder="e.g. 452/600 or 75%" /></div>
            <SecureFileInput name="photo_url" label="📷 Your photo (for the results page)" accept="image/*" folder="awards" />
            <SecureFileInput name="marksheet_url" label="📄 Your marksheet / result (image or PDF)" accept="image/*,application/pdf" folder="awards" />
            <div><label>A short message (optional)</label><textarea name="message" rows={3} placeholder="How our classes helped you…" /></div>
            <label className="remember" style={{ margin: 0 }}>
              <input type="checkbox" name="studied" required /> I confirm I studied using CA Parveen Sharma&apos;s classes / resources.
            </label>
            <SubmitButton className="btn">🏆 Submit my result</SubmitButton>
            <p className="muted" style={{ fontSize: ".76rem", margin: 0 }}>Your marksheet is stored privately and used only to verify your award and (with your consent) to feature your success.</p>
          </form>
        </div>
        <p style={{ marginTop: 14 }}><Link className="grad" href="/results">← See our students&apos; results</Link></p>
      </section>
      <SiteFooter />
    </main>
  );
}
