import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CvBuilder from "./CvBuilder";

export const dynamic = "force-dynamic";
export const metadata = { title: "CV Builder — CA Parveen Sharma" };

export default async function CvPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/career/cv");
  const { data: prof } = await supabase.from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle();
  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <div className="learn-hero no-print" style={{ marginBottom: 18 }}>
        <span className="badge">📄 CV Builder</span>
        <h1>Build your CV</h1>
        <p className="meta">Fill it in, polish the summary with AI, then print or save as PDF. Saved on this device.</p>
      </div>
      <CvBuilder
        defaults={{ name: prof?.full_name ?? "", email: prof?.email ?? user.email ?? "", phone: prof?.phone ?? "" }}
      />
    </section>
  );
}
