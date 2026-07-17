import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "@/app/components/SubmitButton";
import { TICKET_CATEGORIES } from "@/lib/tickets";
import { createSupportTicket } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help & support — CA Parveen Sharma" };

const CATEGORY_LABEL: Record<string, string> = {
  payment: "Payment / subscription", access: "Can't access my classes",
  content: "Question about content", technical: "Website / app not working", other: "Something else",
};

export default async function SupportPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: p } = user ? await supabase.from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle() : { data: null };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 640 }}>
      <div className="learn-hero">
        <span className="badge">🎧 Help &amp; support</span>
        <h1>How can we help?</h1>
        <p className="meta">Tell us what's wrong and our team will get back to you — usually with a call. 📞</p>
      </div>

      {searchParams.ok && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Thanks! Your request <strong>{searchParams.ok}</strong> is logged. We&apos;ll be in touch soon.
        </div>
      )}
      {searchParams.err && <div className="notice err" style={{ marginTop: 16 }}>Please describe your issue and try again.</div>}

      <div className="form-card" style={{ marginTop: 18 }}>
        <form action={createSupportTicket}>
          <label>What do you need help with?</label>
          <input name="title" placeholder="e.g. I paid but can't see my FR classes" required />

          <label style={{ marginTop: 8 }}>Category</label>
          <select name="category" defaultValue="">
            <option value="">— choose —</option>
            {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>

          <label style={{ marginTop: 8 }}>Details</label>
          <textarea name="description" rows={4} placeholder="Tell us what happened, with any error message…" />

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
            <div><label>Your name</label><input name="student_name" defaultValue={(p?.full_name as string) ?? ""} required /></div>
            <div><label>Phone (for a callback)</label><input name="student_phone" defaultValue={(p?.phone as string) ?? ""} placeholder="10-digit" /></div>
          </div>
          <label style={{ marginTop: 4 }}>Email</label>
          <input name="student_email" type="email" defaultValue={(p?.email as string) ?? user?.email ?? ""} required />

          <SubmitButton className="btn" style={{ marginTop: 12 }}>Send request</SubmitButton>
        </form>
      </div>

      <p className="muted" style={{ fontSize: ".82rem", marginTop: 14 }}>
        Prefer chat? You can also reach us on our community channels from your <Link href="/dashboard">dashboard</Link>.
      </p>
    </section>
  );
}
