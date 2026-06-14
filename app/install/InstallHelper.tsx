"use client";

import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };

export default function InstallHelper() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [mode, setMode] = useState<"loading" | "installed" | "ios" | "prompt" | "desktop" | "android">("loading");

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setMode("installed");
      return;
    }
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Mac/.test(ua) && "ontouchend" in document);
    const isAndroid = /android/i.test(ua);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", handler);

    setMode(isIOS ? "ios" : isAndroid ? "android" : "desktop");
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    const res = await deferred.userChoice;
    setDeferred(null);
    if (res.outcome === "accepted") setMode("installed");
  }

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="card" style={{ maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
      {children}
    </div>
  );

  if (mode === "loading") return <Card>…</Card>;

  if (mode === "installed")
    return (
      <Card>
        <div style={{ fontSize: "2.4rem" }}>✅</div>
        <h2 style={{ margin: "8px 0" }}>You&apos;re all set</h2>
        <p className="muted">The app is installed — open it from your home screen or app list.</p>
        <a className="btn" href="/dashboard" style={{ marginTop: 14 }}>
          Open dashboard →
        </a>
      </Card>
    );

  if (mode === "prompt")
    return (
      <Card>
        <div style={{ fontSize: "2.4rem" }}>📲</div>
        <h2 style={{ margin: "8px 0" }}>Install 121 CA Classes</h2>
        <p className="muted">One tap — it adds the app to your device and opens full-screen.</p>
        <button className="btn" onClick={install} style={{ marginTop: 14 }}>
          Install app
        </button>
      </Card>
    );

  if (mode === "ios")
    return (
      <Card>
        <div style={{ fontSize: "2.4rem" }}>🍎</div>
        <h2 style={{ margin: "8px 0" }}>Add to your iPhone</h2>
        <p className="muted">Safari can install this app to your home screen:</p>
        <ol style={{ textAlign: "left", margin: "14px auto", maxWidth: 360, lineHeight: 1.9 }}>
          <li>
            Tap the <strong>Share</strong> button <span style={{ fontSize: "1.1rem" }}>􀈂</span> (the square with an
            up-arrow) at the bottom of Safari.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong> — the 121 CA Classes icon appears on your home screen.
          </li>
        </ol>
        <p className="muted" style={{ fontSize: ".85rem" }}>
          (Must be opened in <strong>Safari</strong>, not Chrome, on iPhone.)
        </p>
      </Card>
    );

  // android (no prompt yet) or desktop
  return (
    <Card>
      <div style={{ fontSize: "2.4rem" }}>{mode === "android" ? "🤖" : "💻"}</div>
      <h2 style={{ margin: "8px 0" }}>Install the app</h2>
      {mode === "android" ? (
        <>
          <p className="muted">In Chrome, open the <strong>⋮</strong> menu and tap:</p>
          <p style={{ fontWeight: 700, marginTop: 8 }}>“Install app” / “Add to Home screen”</p>
        </>
      ) : (
        <>
          <p className="muted">
            In Chrome or Edge, click the <strong>install icon</strong> (⊕ / a small screen) at the right of the
            address bar, then <strong>Install</strong>.
          </p>
        </>
      )}
      <a className="btn secondary" href="/dashboard" style={{ marginTop: 14 }}>
        Continue in browser →
      </a>
    </Card>
  );
}
