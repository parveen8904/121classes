import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "@/app/components/SubmitButton";
import AttemptPicker from "@/app/components/AttemptPicker";
import { updateProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: { saved?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/profile");

  const { data: p } = await supabase
    .from("profiles")
    .select(
      "full_name, phone, target_attempt, address_line1, address_line2, city, state, pincode, gstin, business_name",
    )
    .eq("id", user.id)
    .single();

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb">
          <Link href="/dashboard">← Dashboard</Link>
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

        <form action={updateProfile} style={{ marginTop: 20 }}>
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
            <h3 style={{ marginBottom: 14 }}>Shipping address (for books)</h3>
            <label htmlFor="address_line1">Address line 1</label>
            <input id="address_line1" name="address_line1" defaultValue={p?.address_line1 ?? ""} />
            <label htmlFor="address_line2">Address line 2</label>
            <input id="address_line2" name="address_line2" defaultValue={p?.address_line2 ?? ""} />
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div>
                <label htmlFor="city">City</label>
                <input id="city" name="city" defaultValue={p?.city ?? ""} />
              </div>
              <div>
                <label htmlFor="state">State</label>
                <input id="state" name="state" defaultValue={p?.state ?? ""} />
              </div>
              <div>
                <label htmlFor="pincode">PIN code</label>
                <input id="pincode" name="pincode" defaultValue={p?.pincode ?? ""} />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 4 }}>GST details (optional)</h3>
            <p className="muted" style={{ fontSize: ".85rem", marginBottom: 14 }}>
              Fill these only if you need a GST invoice.
            </p>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label htmlFor="gstin">GSTIN</label>
                <input id="gstin" name="gstin" defaultValue={p?.gstin ?? ""} placeholder="15-digit GSTIN" />
              </div>
              <div>
                <label htmlFor="business_name">Registered business name</label>
                <input id="business_name" name="business_name" defaultValue={p?.business_name ?? ""} />
              </div>
            </div>
          </div>

          <SubmitButton className="btn" style={{ marginTop: 18 }}>
            Save profile
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
