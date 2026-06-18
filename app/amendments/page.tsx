import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Know Your Amendments — 121 CA Classes" };

const ATTEMPTS = ["May 2026", "Nov 2026", "May 2027", "Nov 2027"];

export default async function AmendmentsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/amendments");

  const { data: prof } = await supabase.from("profiles").select("target_attempt").eq("id", user.id).maybeSingle();
  // target_attempt may be stored like "MAY_2026"; normalise to match our labels.
  const raw = (prof?.target_attempt || "").replace(/_/g, " ").toUpperCase();
  const myAttempt = ATTEMPTS.find((a) => a.toUpperCase() === raw) || null;

  const { data } = await supabase.from("site_settings").select("key, value").like("key", "amend:%");
  const map = new Map((data ?? []).map((r) => [(r.key as string).slice(6), (() => { try { return JSON.parse(r.value as string); } catch { return {}; } })()]));

  const mine = myAttempt ? map.get(myAttempt) : null;
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
        <p className="meta">
          What applies to <strong>your attempt</strong>, the last date new amendments can come, and what to expect if you change attempt.
        </p>
      </div>

      {myAttempt ? (
        <div className="card" style={{ marginTop: 16, borderColor: "var(--accent)" }}>
          <h3 style={{ margin: "0 0 4px" }}>Your attempt: {myAttempt}</h3>
          {mine?.cutoff && <p style={{ margin: "6px 0" }}>🗓️ <strong>Amendments cut-off:</strong> {mine.cutoff} <span className="muted">(amendments after this date won&apos;t apply to your attempt)</span></p>}
          {mine?.applicable && <><p className="muted" style={{ fontSize: ".82rem", margin: "10px 0 2px" }}>Applicable so far:</p><p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{mine.applicable}</p></>}
          {mine?.expected && <><p className="muted" style={{ fontSize: ".82rem", margin: "10px 0 2px" }}>Expected before the cut-off:</p><p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{mine.expected}</p></>}
          {!mine?.cutoff && !mine?.applicable && <p className="muted">Details for your attempt will be updated soon.</p>}
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted">Set your <strong>target attempt</strong> in your profile to see exactly which amendments apply to you.</p>
        </div>
      )}

      {/* If you change attempt */}
      <h3 style={{ marginTop: 24, fontSize: "1rem" }}>If you change your attempt</h3>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {ATTEMPTS.filter((a) => a !== myAttempt).map((a) => {
          const v = map.get(a);
          if (!v?.cutoff && !v?.applicable && !v?.expected) return null;
          return (
            <div className="card" key={a}>
              <strong>{a}</strong>
              {v.cutoff && <p style={{ margin: "4px 0" }}>🗓️ Cut-off: {v.cutoff}</p>}
              {v.expected && <p className="muted" style={{ fontSize: ".88rem", whiteSpace: "pre-wrap" }}>Expected: {v.expected}</p>}
            </div>
          );
        })}
      </div>

      {/* Recent amendment announcements */}
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
