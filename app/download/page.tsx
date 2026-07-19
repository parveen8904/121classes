import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Download the app — CA Parveen Sharma",
  description: "Download the CA Parveen Sharma desktop app for Mac & Windows to watch classes offline, securely.",
};

const GRAD = "linear-gradient(135deg,#0d9488,#10b981)";

export default async function DownloadPage() {
  const supabase = createClient();
  const { data } = await supabase.from("site_settings").select("key, value").in("key", ["app_url_mac", "app_url_windows", "app_url_web", "app_url_ios", "app_url_android"]);
  const m = new Map((data ?? []).map((r) => [r.key, (r.value as string) || ""]));
  const mac = m.get("app_url_mac") || "";
  const win = m.get("app_url_windows") || "";
  const ios = m.get("app_url_ios") || "";
  const android = m.get("app_url_android") || "";

  const Card = ({ icon, title, note, href, steps }: { icon: string; title: string; note: string; href: string; steps: string[] }) => (
    <div className="tile" style={{ textAlign: "left" }}>
      <div style={{ fontSize: "2rem" }}>{icon}</div>
      <h3 style={{ fontSize: "1.1rem", margin: "8px 0 4px" }}>{title}</h3>
      <p className="muted" style={{ fontSize: ".86rem", marginTop: 0 }}>{note}</p>
      {href ? (
        <a className="btn" href={href} target="_blank" rel="noopener noreferrer" style={{ marginTop: 4 }}>⬇️ Download for {title}</a>
      ) : (
        <span className="btn secondary" style={{ marginTop: 4, opacity: 0.7, pointerEvents: "none" }}>Coming soon</span>
      )}
      <ol style={{ margin: "12px 0 0 18px", padding: 0, display: "grid", gap: 4, fontSize: ".82rem", color: "var(--muted)" }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  );

  return (
    <main>
      <section className="section" style={{ paddingTop: 40 }}>
        <div style={{ background: GRAD, color: "#fff", borderRadius: 22, padding: "40px 28px", textAlign: "center" }}>
          <span style={{ display: "inline-block", background: "rgba(255,255,255,.18)", padding: "4px 12px", borderRadius: 999, fontSize: ".8rem", fontWeight: 700 }}>💻 Desktop app</span>
          <h1 style={{ color: "#fff", fontSize: "2rem", margin: "14px 0 8px" }}>Watch your classes offline — safely</h1>
          <p style={{ maxWidth: 620, margin: "0 auto", fontSize: "1.02rem", color: "rgba(255,255,255,.95)" }}>
            Install the app, log in, and download your classes to watch any time — even without internet. Downloaded classes are
            <strong> encrypted and locked to the app</strong>, so they stay protected.
          </p>
        </div>

        <div className="grid grid-3" style={{ marginTop: 24 }}>
          <Card
            icon="🍎"
            title="Mac"
            note="macOS 10.12+ (Intel & Apple Silicon)."
            href={mac}
            steps={["Open the .dmg and drag the app to Applications.", "Open it from Applications — no security warnings (notarized by Apple).", "Log in and download your classes."]}
          />
          <Card
            icon="🪟"
            title="Windows"
            note="Windows 10/11 (64-bit)."
            href={win}
            steps={["Run the installer (Setup .exe).", "If Windows warns: More info → Run anyway.", "Log in and download your classes."]}
          />
          <div className="tile" style={{ textAlign: "left" }}>
            <div style={{ fontSize: "2rem" }}>🌐</div>
            <h3 style={{ fontSize: "1.1rem", margin: "8px 0 4px" }}>Phone / Web app</h3>
            <p className="muted" style={{ fontSize: ".86rem", marginTop: 0 }}>Use it like an app on Android &amp; iPhone — install from the browser.</p>
            <Link className="btn secondary" href="/install" style={{ marginTop: 4 }}>How to install on phone →</Link>
            {(ios || android) && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {ios && <a className="btn small secondary" href={ios} target="_blank" rel="noopener noreferrer">iPhone</a>}
                {android && <a className="btn small secondary" href={android} target="_blank" rel="noopener noreferrer">Android</a>}
              </div>
            )}
          </div>
        </div>

        {!mac && !win && (
          <p className="muted" style={{ textAlign: "center", marginTop: 20, fontSize: ".9rem" }}>
            📦 The desktop apps will appear here as soon as they&apos;re published.
          </p>
        )}

        <p className="muted" style={{ textAlign: "center", marginTop: 24, fontSize: ".85rem" }}>
          Already installed? Just open the app and <Link href="/login" className="grad">log in</Link> — your dashboard opens straight away.
        </p>
      </section>
    </main>
  );
}
