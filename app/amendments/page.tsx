import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AmendmentPicker from "./AmendmentPicker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Know Your Amendments — 121 CA Classes" };

const ATTEMPTS = ["May 2026", "Nov 2026", "May 2027", "Nov 2027"];

export default async function AmendmentsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/amendments");

  const { data: prof } = await supabase.from("profiles").select("target_attempt").eq("id", user.id).maybeSingle();
  const raw = (prof?.target_attempt || "").replace(/_/g, " ").toUpperCase();
  const myAttempt = ATTEMPTS.find((a) => a.toUpperCase() === raw) || ATTEMPTS[0];

  const { data } = await supabase.from("site_settings").select("key, value").like("key", "amend:%");
  const map: Record<string, { cutoff?: string; applicable?: string; expected?: string }> = {};
  for (const r of data ?? []) {
    try { map[(r.key as string).slice(6)] = JSON.parse(r.value as string); } catch {}
  }

  const { data: announcements } = await supabase
    .from("announcements")
    .select("id, title, body, link_url, published_at")
    .eq("kind", "amendment")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(8);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <div className="learn-hero">
        <span className="badge">📜 Amendments</span>
        <h1>Know your amendments</h1>
        <p className="meta">Select your attempt to see exactly what applies, the cut-off date, and what&apos;s expected.</p>
      </div>

      <AmendmentPicker attempts={ATTEMPTS} data={map} initial={myAttempt} />

      {(announcements ?? []).length > 0 && (
        <>
          <h3 style={{ marginTop: 24, fontSize: "1rem" }}>📣 Latest amendment updates</h3>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {(announcements ?? []).map((a) => (
              <div className="card" key={a.id}>
                <strong>{a.title}</strong>
                {a.body && <p className="muted" style={{ fontSize: ".88rem", marginTop: 4 }}>{a.body}</p>}
                {a.link_url && <a href={a.link_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".85rem" }}>Read more →</a>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
