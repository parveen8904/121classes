import Link from "next/link";
import SiteNav from "../components/SiteNav";
import SiteFooter from "../components/SiteFooter";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "How to install the app — 1:1 CA Classes" };

export default async function InstallHelpPage() {
  const supabase = createClient();
  const { data: settings } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["app_url_mac", "app_url_windows", "app_url_web"]);
  const s = new Map((settings ?? []).map((r) => [r.key, r.value as string | null]));
  const mac = s.get("app_url_mac") || "";
  const win = s.get("app_url_windows") || "";

  const Btn = ({ href, label }: { href: string; label: string }) =>
    href ? (
      <a className="btn" href={href} style={{ marginTop: 6 }}>
        {label}
      </a>
    ) : (
      <span className="muted" style={{ marginTop: 6, display: "inline-block" }}>
        Coming soon
      </span>
    );

  const card = { maxWidth: 760, margin: "0 auto 16px" } as const;

  return (
    <main>
      <SiteNav />
      <section className="section" style={{ paddingTop: 50 }}>
        <div className="section-head">
          <div className="eyebrow">Help</div>
          <h2>How to install the app</h2>
          <p>Pick your device. It only takes a minute.</p>
        </div>

        {/* WEB / PHONE */}
        <div className="card" style={card}>
          <h3>🌐 Web app (any device — phone or computer)</h3>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            Works instantly in your browser, and you can install it to your home screen / desktop so it
            opens like an app.
          </p>
          <ol style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li>Open <strong>121caclasses.com</strong> and log in.</li>
            <li>To install it, tap <strong>Install</strong> below — it detects your device and guides you.</li>
          </ol>
          <Link className="btn" href="/install" style={{ marginTop: 6 }}>
            Install on this device →
          </Link>
        </div>

        {/* MAC */}
        <div className="card" style={card}>
          <h3>🍎 Mac app (download classes &amp; watch offline)</h3>
          <ol style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li>Click <strong>Download for Mac</strong> below.</li>
            <li>Open the downloaded <strong>.dmg</strong> file (in your Downloads).</li>
            <li>Drag <strong>1to1 CA Classes</strong> into your <strong>Applications</strong> folder.</li>
            <li>Open it from Applications — it launches straight away (no warning).</li>
            <li>Sign in with your normal account, then download any class to watch offline.</li>
          </ol>
          <Btn href={mac} label="⬇️ Download for Mac" />
        </div>

        {/* WINDOWS */}
        <div className="card" style={card}>
          <h3>🪟 Windows app (download classes &amp; watch offline)</h3>
          <ol style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li>Click <strong>Download for Windows</strong> below.</li>
            <li>Open the downloaded <strong>.exe</strong> installer.</li>
            <li>
              If Windows shows <em>“Windows protected your PC”</em>, click <strong>More info</strong> →{" "}
              <strong>Run anyway</strong>. (The app is safe — this notice just appears until our Windows
              certificate is finalised.)
            </li>
            <li>It installs and opens. Sign in, then download any class to watch offline.</li>
          </ol>
          <Btn href={win} label="⬇️ Download for Windows" />
        </div>

        {/* IPHONE */}
        <div className="card" style={card}>
          <h3>📱 iPhone</h3>
          <ol style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li>Open <strong>121caclasses.com</strong> in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button (square with an up-arrow).</li>
            <li>Tap <strong>Add to Home Screen</strong> → <strong>Add</strong>.</li>
          </ol>
          <Link className="btn" href="/install" style={{ marginTop: 6 }}>
            Show me how →
          </Link>
        </div>

        {/* ANDROID */}
        <div className="card" style={card}>
          <h3>🤖 Android</h3>
          <ol style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li>Open <strong>121caclasses.com</strong> in <strong>Chrome</strong>.</li>
            <li>Tap the <strong>⋮</strong> menu → <strong>Install app</strong> (or “Add to Home screen”).</li>
          </ol>
          <Link className="btn" href="/install" style={{ marginTop: 6 }}>
            One-tap install →
          </Link>
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 24 }}>
          Stuck? Message us on WhatsApp or Telegram using the buttons in the bottom-right corner. 💬
        </p>
      </section>
      <SiteFooter />
    </main>
  );
}
