import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sellableProducts } from "@/lib/supporterCatalogue";
import { razorpayConfigured } from "@/lib/razorpay";
import SellForm from "./SellForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Place an order — Supporter" };

// A supporter placing an order for a student.
//
// The billing side is NOT asked here — it is whatever is on their profile, so
// the same GSTIN and address land on every invoice without being retyped (and
// mistyped) on every sale.
export default async function SellPage(props: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter/sell");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles")
    .select("full_name, email, phone, is_supporter, role, gstin, business_name, address_line1, address_line2, city, state, pincode")
    .eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin" && me?.role !== "supporter") redirect("/dashboard");

  const products = await sellableProducts();

  // Their standing 25% code, made on first sight if they do not have one. It is
  // filled in for them below: a discount they have to remember to type is a
  // discount somebody will forget on a Friday evening and eat themselves.
  const { ensureSupporterCoupon } = await import("@/lib/supporterCoupon");
  const coupon = await ensureSupporterCoupon(user.id);

  const billingAddress = [me?.address_line1, me?.address_line2, [me?.city, me?.pincode].filter(Boolean).join(" ")]
    .filter(Boolean).join("\n");

  // Their own billing details have to be right before they can invoice anybody.
  const needsProfile = !String(me?.state ?? "").trim();

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 720 }}>
        <p className="crumb" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Link href="/supporter">← My desk</Link>
          <a href="/auth/signout" style={{ fontSize: ".85rem" }}>Log out</a>
        </p>
        <span className="badge">🛒 New order</span>
        <h1 style={{ margin: "12px 0 6px" }}>Place an order for a student</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          The student gets their own login and the printed books by post. Your invoice comes to you — they are never
          told what was paid.
        </p>

        {needsProfile ? (
          <div className="card" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>First, your own details</h2>
            <p className="muted">
              Your billing state decides the tax on your invoice, so it is needed before the first sale. It is asked
              once and then remembered.
            </p>
            <Link className="btn" href="/supporter/profile?next=/supporter/sell">Fill my details →</Link>
          </div>
        ) : (
          <SellForm
            products={products}
            preselect={sp.subject}
            myCoupon={coupon?.code ?? ""}
            configured={await razorpayConfigured()}
            billing={{
              name: (me?.business_name as string) || (me?.full_name as string) || "",
              gstin: (me?.gstin as string) || "",
              address: billingAddress,
              state: (me?.state as string) || "Delhi",
            }}
          />
        )}
      </section>
    </main>
  );
}
