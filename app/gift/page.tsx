import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { razorpayConfigured } from "@/lib/razorpay";
import GiftForm from "./GiftForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sponsor a Student — CA Parveen Sharma" };

export default async function GiftPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/gift");

  const svc = createServiceClient();
  const { data: subjects } = await svc
    .from("subjects")
    .select("id, title, gold_price_inr, courses(title)")
    .order("order_index");
  const { data: plans } = await svc.from("plans").select("tier, name, web_price_inr").eq("is_active", true).in("tier", ["silver", "gold"]).order("rank");
  const configured = await razorpayConfigured();

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 640 }}>
        <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <div className="learn-hero">
          <span className="badge">🎁 Sponsor a Student</span>
          <h1 style={{ fontSize: "1.5rem" }}>Sponsor a Student · Gift a subscription</h1>
          <p className="meta">Pay for a subscription and we&apos;ll set it up for the person you choose. Your receipt &amp; GST invoice come to you; they just get access — they never see the amount.</p>
        </div>
        {!configured && (
          <div className="notice err" style={{ marginTop: 16 }}>Online payment isn&apos;t enabled yet. Please check back soon, or contact us to gift a subscription.</div>
        )}
        <GiftForm
          configured={configured}
          subjects={(subjects ?? []).map((s) => ({ id: s.id as string, title: s.title as string, course: (s as { courses?: { title?: string } | null }).courses?.title ?? "", gold: (s as { gold_price_inr?: number | null }).gold_price_inr ?? null }))}
          plans={(plans ?? []).map((p) => ({ tier: p.tier as string, name: p.name as string, price: (p as { web_price_inr?: number | null }).web_price_inr ?? null }))}
        />
      </section>
    </main>
  );
}
