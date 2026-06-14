import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";
import NotifyButton from "../components/NotifyButton";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar — 121 CA Classes" };

type Session = {
  id: string;
  title: string;
  audience: string | null;
  starts_at: string | null;
  join_url: string | null;
};

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export default async function CalendarPage() {
  const supabase = createClient();
  const [{ data: sessions }, { data: auth }] = await Promise.all([
    supabase
      .from("live_sessions")
      .select("id, title, audience, starts_at, join_url")
      .eq("is_published", true)
      .gte("starts_at", new Date(Date.now() - 3 * 3600 * 1000).toISOString())
      .order("starts_at")
      .limit(60),
    supabase.auth.getUser(),
  ]);
  const signedIn = !!auth?.user;
  const list = (sessions ?? []) as Session[];

  // group by day
  const groups = new Map<string, Session[]>();
  for (const s of list) {
    if (!s.starts_at) continue;
    const k = dayKey(s.starts_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }

  return (
    <main>
      <SiteNav />
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
        <div className="section-head" style={{ marginBottom: 24 }}>
          <div className="eyebrow">🗓️ Calendar</div>
          <h2>Upcoming lectures &amp; events</h2>
          <p>Live classes and events scheduled by CA Parveen Sharma &amp; team. Tap <strong>Notify me</strong> to get a reminder.</p>
        </div>

        {groups.size === 0 ? (
          <div className="card"><p className="muted">No upcoming sessions scheduled yet — check back soon. ✨</p></div>
        ) : (
          <div style={{ display: "grid", gap: 22 }}>
            {[...groups.entries()].map(([day, items]) => (
              <div key={day}>
                <h3 style={{ fontSize: "1rem", margin: "0 0 10px", color: "var(--accent)" }}>{day}</h3>
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((s) => (
                    <div className="card" key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{s.title}</div>
                        <div className="muted" style={{ fontSize: ".85rem", marginTop: 2 }}>
                          🕒 {s.starts_at ? timeOf(s.starts_at) : "TBA"}
                          {s.audience ? ` · ${s.audience}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {s.join_url && (
                          <a className="btn small" href={s.join_url} target="_blank" rel="noopener noreferrer">📡 Join</a>
                        )}
                        <NotifyButton sessionId={s.id} signedIn={signedIn} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
