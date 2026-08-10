import { formatDate } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { acceptSupporterTerms } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "How this works — Supporter" };

// WHAT THEY ARE AGREEING TO, AND HOW TO PLACE AN ORDER.
//
// Both on one page on purpose. A supporter reads this once, at the start, and
// the rules only mean anything if they arrive alongside the instructions rather
// than buried in a document nobody opens.
//
// Written plainly. A penalty explained in legal language reads as a threat; the
// same penalty explained in ordinary words reads as a rule, and rules are what
// people actually follow.

export default async function SupporterTerms(props: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter/terms");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles")
    .select("is_supporter, role, supporter_terms_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin" && me?.role !== "supporter") redirect("/dashboard");

  const accepted = (me as { supporter_terms_at?: string | null } | null)?.supporter_terms_at ?? null;

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 70, maxWidth: 760 }}>
        <p className="crumb"><Link href="/supporter">← My desk</Link></p>
        <span className="badge">📋 How this works</span>
        <h1 style={{ margin: "12px 0 6px" }}>Selling these courses</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          Everything you need in one place: how to place an order, and the three rules that hold the
          arrangement together.
        </p>

        <div className="card" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Placing an order</h2>
          <ol style={{ lineHeight: 1.9, paddingLeft: 20 }}>
            <li><strong>Fill in your details once</strong> — name, GSTIN, billing and shipping address,
              phone, email, and the website you sell from. Your GSTIN and address then appear on every
              invoice without retyping.</li>
            <li><strong>Verify your website.</strong> Publish the code we give you anywhere on it, then
              press Check. This is how we know the site is yours.</li>
            <li><strong>Open “Place an order”</strong> and enter the student&apos;s name, email and
              postal address. Their login is created from that email, so it must be theirs.</li>
            <li><strong>Choose the subject and the term</strong> — 12, 18 or 24 months. Prices are
              exactly what a student pays on the website.</li>
            <li><strong>Choose when their access starts.</strong> Selling early costs them nothing:
              the months begin on the date you pick, not the day you pay.</li>
            <li><strong>Apply your coupon</strong> and press Apply — the discounted amount is shown
              before you pay, and it is the amount charged.</li>
            <li><strong>Pay.</strong> The student is emailed a link to set their password. Your
              invoice appears under Your orders. The student is never told what you paid.</li>
          </ol>
        </div>

        <div className="card" style={{ marginTop: 18, borderLeft: "4px solid #b45309" }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>The three rules</h2>

          <p style={{ lineHeight: 1.8 }}>
            <strong>1. Never more than 5% off.</strong> You may pass on a discount of up to five per
            cent. Beyond that you are teaching students to wait for a reseller instead of buying at
            the published price, which damages every supporter including you.
          </p>
          <p style={{ lineHeight: 1.8 }}>
            <strong>2. Never bundled with another faculty.</strong> You may sell these courses
            alongside anything else you sell. You may not combine them into one package or one price
            with another teacher&apos;s course. CA Parveen Sharma&apos;s name is not part of somebody
            else&apos;s combo.
          </p>
          <p style={{ lineHeight: 1.8 }}>
            <strong>3. One declared website, and it must be yours.</strong> We read it from time to
            time to check the two rules above. Nothing is scraped beyond your public pages.
          </p>

          <p style={{ lineHeight: 1.8, marginTop: 14 }}>
            <strong>If a rule is broken.</strong> Your account is put on hold. You can still sign in,
            see your orders, download your invoices and support the students you have already sold to
            — but no new order can be placed. It is released on payment of a <strong>₹5,000
            penalty</strong>.
          </p>
          <p className="muted" style={{ fontSize: ".85rem", lineHeight: 1.7 }}>
            Nothing is decided by a machine. A check that finds something is read by a person here
            before anything happens to your account, and you will be told what was seen and where.
          </p>
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>If you see somebody else breaking them</h2>
          <p style={{ lineHeight: 1.8 }}>
            You see the market before we do. If another seller is discounting heavily or bundling
            these courses, <Link href="/supporter/complaint">tell us</Link> — send the page address
            and a short video or voice note showing what is happening. Our team checks it. If it is
            upheld, that account goes on hold on the same terms as yours would.
          </p>
          <p className="muted" style={{ fontSize: ".85rem" }}>
            Complaints are read by us only. The seller is never told who reported them.
          </p>
        </div>

        {accepted ? (
          <p className="muted" style={{ marginTop: 18, fontSize: ".88rem" }}>
            You accepted these on{" "}
            {formatDate(accepted)}.
          </p>
        ) : (
          <form action={acceptSupporterTerms} style={{ marginTop: 18 }}>
            <input type="hidden" name="next" value={sp.next ?? "/supporter"} />
            <SubmitButton className="btn" savedLabel="✓ Accepted">I have read and accept these</SubmitButton>
          </form>
        )}
      </section>
    </main>
  );
}
