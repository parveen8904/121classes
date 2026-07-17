import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import ZoomEmbed from "./ZoomEmbed";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live class — CA Parveen Sharma" };

// White-label live class: students watch inside caparveensharma.com. They never
// see (or can copy) a zoom.us link — joining happens via a server-issued
// signature for logged-in students only.
export default async function JoinLivePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/live/join/${params.id}`);

  const svc = createServiceClient();
  const { data: s } = await svc
    .from("live_sessions")
    .select("id, title, audience, is_published, zoom_meeting_number")
    .eq("id", params.id)
    .maybeSingle();
  if (!s || !s.is_published) notFound();

  return (
    <main>
      <section className="container" style={{ paddingTop: 24, paddingBottom: 48, maxWidth: 1000 }}>
        <p className="crumb"><Link href="/live">← Live classes</Link></p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <span className="badge">📡 Live class</span>
          <h1 style={{ fontSize: "1.4rem", margin: 0 }}>{s.title}</h1>
          {s.audience && <span className="muted" style={{ fontSize: ".85rem" }}>{s.audience}</span>}
        </div>
        {s.zoom_meeting_number ? (
          <ZoomEmbed sessionId={s.id} title={s.title} />
        ) : (
          <div className="card"><p className="muted" style={{ margin: 0 }}>This class isn&apos;t set up for live viewing yet — please check back at the scheduled time.</p></div>
        )}
        <p className="muted" style={{ fontSize: ".78rem", marginTop: 12 }}>
          🔒 This class is only for enrolled students and plays inside our platform. Please don&apos;t record or share it.
        </p>
      </section>
    </main>
  );
}
