import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../../_components/AdminHero";
import SeriesForm from "./SeriesForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "A run of posts — Admin" };

export default async function SeriesPage(props: { searchParams: Promise<{ err?: string }> }) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/campaigns/series");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 860 }}>
      <p style={{ marginBottom: 6 }}>
        <Link className="muted" href="/admin/campaigns">← Marketing &amp; campaigns</Link>
      </p>
      <AdminHero
        badge="🗂️ A run of posts"
        title="Several posts to one place, each on its own day"
        subtitle="Seven posts for X across a week, or four for LinkedIn across a month. Different wording each time, different day each time — not one message copied into every room at once."
      />

      {sp.err === "nochannel" && (
        <div className="notice err" style={{ marginTop: 14 }}>Choose at least one place for these to go.</div>
      )}
      {sp.err === "empty" && (
        <div className="notice err" style={{ marginTop: 14 }}>Write at least one post — the blank rows are ignored.</div>
      )}

      <div className="notice" style={{ marginTop: 14, fontSize: ".86rem", lineHeight: 1.7 }}>
        <strong>This is the other half of the campaign screen.</strong> A campaign takes one message and puts it
        everywhere at once, which is right for an announcement. This takes many messages and spaces them out in one
        place, which is right for everything else. Both land as drafts and both wait for your approval.
      </div>

      <SeriesForm />
    </section>
  );
}
