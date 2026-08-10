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
    .select("full_name, business_name, phone, email, address_line1, address_line2, city, state, pincode, gstin, is_supporter, role, supporter_site, supporter_site_ok_at, supporter_terms_at, supporter_blocked_at, supporter_block_reason")
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

  // COMPLETE, PROVED, AGREED AND NOT ON HOLD — the same check the server makes
  // when the order is actually created, so this screen can never promise
  // something the payment button will refuse.
  const { supporterReadiness } = await import("@/lib/supporterReady");
  const ready = supporterReadiness(me as never);

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

        {/* SHOWN, NOT SUBSTITUTED.
            The form stays. A vendor who has not finished signing up should be
            able to walk through the whole thing and see what selling here is
            like — the subjects, the terms, their own discount, what a student
            pays. Hiding it until the paperwork is done teaches them nothing and
            makes the paperwork feel like a wall. So: they can fill it in, and
            the one thing they cannot do is pay. */}
        {!ready.ready && (
          <div className="card" style={{ marginTop: 18, borderLeft: `4px solid ${ready.blocked ? "#b91c1c" : "#eab308"}` }}>
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              {ready.blocked ? "⛔ Your account is on hold — orders are paused" : "🔒 You cannot place an order yet"}
            </h2>
            {ready.blocked ? (
              <>
                <p style={{ lineHeight: 1.7, margin: "6px 0" }}>
                  Everything else is untouched — you can sign in, see your orders, download your invoices, and the
                  students you have already sold to are unaffected. Look around this page as much as you like.
                </p>
                {ready.blockReason && (
                  <p className="muted" style={{ lineHeight: 1.7 }}><strong>What was found:</strong> {ready.blockReason}</p>
                )}
                <p style={{ lineHeight: 1.7, margin: "6px 0 0" }}>
                  To lift it, please call the office on <strong>98100 12674</strong>. If you believe it is a mistake,
                  say so — it is read by a person.
                </p>
              </>
            ) : (
              <>
                <p className="muted" style={{ lineHeight: 1.7, margin: "6px 0" }}>
                  Have a look through — everything below works, and you will see exactly what a student pays and what
                  you pay. To take payment we need{" "}
                  {ready.missing.length === 1 ? "one more thing" : `${ready.missing.length} more things`}, each asked
                  once and then remembered.
                </p>
                <ol style={{ lineHeight: 1.8, paddingLeft: 20, margin: "8px 0 0" }}>
                  {ready.missing.map((m) => (
                    <li key={m.what} style={{ marginBottom: 10 }}>
                      <strong>{m.what}</strong>
                      <span className="muted" style={{ display: "block", fontSize: ".85rem", lineHeight: 1.6 }}>{m.why}</span>
                      <Link className="btn small" href={m.href} style={{ marginTop: 6 }}>Do this →</Link>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}

          <SellForm
            products={products}
            preselect={sp.subject}
            myCoupon={coupon?.code ?? ""}
            locked={
              ready.ready ? undefined
                : ready.blocked ? "Your account is on hold, so no new order can be placed."
                : ready.missing.length === 1
                  ? `One thing is still needed before you can take payment: ${ready.missing[0].what.toLowerCase()}.`
                  : `${ready.missing.length} things are still needed before you can take payment.`
            }
            configured={await razorpayConfigured()}
            billing={{
              name: (me?.business_name as string) || (me?.full_name as string) || "",
              gstin: (me?.gstin as string) || "",
              address: billingAddress,
              state: (me?.state as string) || "Delhi",
            }}
          />
      </section>
    </main>
  );
}
