import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLiveState } from "@/lib/liveStream";

export const dynamic = "force-dynamic";
export const metadata = {
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/live/now" }, title: "Live class" };

// The one address a student ever needs for live classes: if Sir is live, the
// player is here; if not, it says so. Login required — the page is inside the
// portal wall, which is the same gate the Zoom links use.
export default async function LiveNowPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/live/now");

  const state = await getLiveState();

  if (!state.on || !state.playback_uid || !state.customer_code) {
    return (
      <section className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 760, textAlign: "center" }}>
        <h1>No live class right now</h1>
        <p className="muted" style={{ marginTop: 10 }}>
          When a live class starts, this page becomes the player — and we announce it on the Telegram channel and your
          subject groups. Recordings appear on the portal after each class.
        </p>
        <p style={{ marginTop: 18 }}>
          <Link prefetch={false} className="btn" href="/dashboard">← Back to dashboard</Link>
        </p>
      </section>
    );
  }

  const embed = `https://customer-${state.customer_code}.cloudflarestream.com/${state.playback_uid}/iframe?autoplay=true`;
  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ background: "#dc2626", color: "#fff", borderRadius: 8, padding: "3px 12px", fontWeight: 800, fontSize: ".85rem" }}>🔴 LIVE</span>
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>{state.title}</h1>
      </div>
      <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "#000" }}>
        <iframe
          src={embed}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <p className="muted" style={{ fontSize: ".84rem", marginTop: 12 }}>
        Ask doubts in your subject&apos;s Telegram group during class — they are picked up live. If the video stalls,
        refresh this page; the stream reconnects on its own.
      </p>
    </section>
  );
}
