import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Career Corner — 121 CA Classes" };

function Block({ icon, title, body }: { icon: string; title: string; body: string }) {
  if (!body?.trim()) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 8px" }}>{icon} {title}</h3>
      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}

export default async function CareerPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/career");

  const { data } = await supabase.from("site_settings").select("key, value").in("key", ["career_articleship", "career_placement", "career_resources"]);
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const any = ["career_articleship", "career_placement", "career_resources"].some((k) => (m.get(k) || "").trim());

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <div className="learn-hero">
        <span className="badge">🎓 Career Corner</span>
        <h1>Career corner</h1>
        <p className="meta">Articleship, placements, interviews and opportunities — guidance from CA Parveen Sharma &amp; team.</p>
      </div>
      {any ? (
        <>
          <Block icon="📄" title="Articleship guidance" body={m.get("career_articleship") || ""} />
          <Block icon="💼" title="Placement & interviews" body={m.get("career_placement") || ""} />
          <Block icon="🔗" title="Resources & opportunities" body={m.get("career_resources") || ""} />
        </>
      ) : (
        <div className="card" style={{ marginTop: 16 }}><p className="muted">Career guidance is coming soon. ✨</p></div>
      )}
    </section>
  );
}
