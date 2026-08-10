import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import PdfUpload from "@/app/admin/_components/PdfUpload";
import { fileSupporterComplaint } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report a seller — Supporter" };

// SUPPORTERS SEE THE MARKET BEFORE WE DO.
//
// Somebody discounting forty percent is visible to every other seller within a
// week, and invisible here until a student mentions it. So the people with the
// most to lose from it are given a way to say so — with evidence, because an
// accusation without any is just a rival's word about a rival.
//
// The reporter is never named to the seller. Without that promise nobody
// reports anybody they might meet at a conference.

export default async function ComplaintPage(props: {
  searchParams: Promise<{ sent?: string; err?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter/complaint");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles").select("is_supporter, role").eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin" && me?.role !== "supporter") redirect("/dashboard");

  const { data: mine } = await svc
    .from("supporter_complaints")
    .select("id, against_url, status, created_at, outcome_note")
    .eq("raised_by", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 70, maxWidth: 720 }}>
        <p className="crumb"><Link href="/supporter">← My desk</Link></p>
        <span className="badge">🚩 Report a seller</span>
        <h1 style={{ margin: "12px 0 6px" }}>Somebody is not playing fair</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          If another seller is discounting these courses by more than 5%, or bundling them with
          another teacher&apos;s package, tell us. Send the page address and something that shows it
          — a short screen recording or a voice note explaining what you saw.
        </p>

        {sp.sent === "1" && (
          <div className="notice ok" style={{ marginTop: 14 }}>
            Thank you — this has gone to the team. You will be told the outcome on this page.
          </div>
        )}
        {sp.err && <div className="notice err" style={{ marginTop: 14 }}>⚠️ {sp.err}</div>}

        <form action={fileSupporterComplaint} className="card" style={{ marginTop: 18 }}>
          <label htmlFor="url">Their page address <span style={{ color: "#b91c1c" }}>*</span></label>
          <input id="url" name="against_url" required placeholder="https://theirsite.com/the-page-you-saw" />
          <p className="muted" style={{ fontSize: ".8rem", marginTop: -2 }}>
            The exact page, not just the home page, so the team can see the same thing you did.
          </p>

          <label htmlFor="what">What is happening <span style={{ color: "#b91c1c" }}>*</span></label>
          <textarea
            id="what"
            name="what_happened"
            rows={4}
            required
            placeholder="What you saw, and when. Plain words are fine."
            style={{ width: "100%", background: "var(--bg-soft)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", fontFamily: "inherit" }}
          />

          {/* Their own words carry further than a description of them. */}
          <PdfUpload
            name="evidence_url"
            folder="complaints"
            label="Evidence — a screen recording, a photo, or a voice note (optional but it helps)"
          />

          <SubmitButton className="btn block">Send this to the team</SubmitButton>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 8, textAlign: "center" }}>
            Read by CA Parveen Sharma&apos;s team only. The seller is never told who reported them.
          </p>
        </form>

        {(mine ?? []).length > 0 && (
          <>
            <h2 style={{ fontSize: "1.05rem", marginTop: 26 }}>What you have reported</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {(mine ?? []).map((c) => (
                <div className="card" key={c.id as string}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: ".9rem", wordBreak: "break-all" }}>{String(c.against_url)}</strong>
                    <span className="badge" style={{ marginLeft: "auto" }}>
                      {c.status === "open" ? "Being checked" : c.status === "upheld" ? "Upheld" : "Not upheld"}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: ".8rem" }}>
                    {new Date(String(c.created_at)).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                    {c.outcome_note ? ` · ${c.outcome_note}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
