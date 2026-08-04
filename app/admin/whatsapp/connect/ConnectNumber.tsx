"use client";

import { useEffect, useState } from "react";

// Meta's Embedded Signup, run from our own page.
//
// Coexistence — keeping the number on his phone AND on the Cloud API — is not
// offered anywhere in Business Manager. "Add phone number" there is a normal
// registration, and completing it would take WhatsApp OFF his phone, which is
// the one outcome he ruled out. The supported route is this flow, launched by
// our own Meta app, where he picks his existing WhatsApp Business app number
// and scans a QR from Settings → Linked devices.
//
// Nothing here can deregister a number: Embedded Signup with the coexistence
// feature only ever links.

declare global {
  interface Window {
    FB?: {
      init: (o: Record<string, unknown>) => void;
      login: (cb: (r: unknown) => void, o: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type Result = { phone_number_id?: string; waba_id?: string };

export default function ConnectNumber({ appId, configId }: { appId: string; configId: string }) {
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    // Meta posts the chosen number back through a message event.
    const onMessage = (e: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.type === "WA_EMBEDDED_SIGNUP" && d?.data) {
          setResult({ phone_number_id: d.data.phone_number_id, waba_id: d.data.waba_id });
        }
      } catch { /* not ours */ }
    };
    window.addEventListener("message", onMessage);

    if (window.FB) { setReady(true); return () => window.removeEventListener("message", onMessage); }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v23.0" });
      setReady(true);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => setNote("Meta's script could not load — check your connection and reload.");
    document.body.appendChild(s);
    return () => window.removeEventListener("message", onMessage);
  }, [appId]);

  const start = () => {
    setNote(null);
    if (!window.FB) { setNote("Meta's script has not loaded yet — wait a moment and try again."); return; }
    window.FB.login(
      () => { /* the number comes back on the message event above */ },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          // Ask Meta for the coexistence path: keep the number on the phone.
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  };

  return (
    <div>
      <button className="btn" type="button" onClick={start} disabled={!ready}>
        {ready ? "📲 Connect my WhatsApp number (keeps it on my phone)" : "Loading Meta's connector…"}
      </button>

      {note && <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>{note}</p>}

      {result?.phone_number_id && (
        <div className="notice ok" style={{ marginTop: 12 }}>
          ✅ Connected. Phone number ID <strong>{result.phone_number_id}</strong>
          {result.waba_id && <> · account <strong>{result.waba_id}</strong></>}
          <p style={{ margin: "8px 0 0" }}>
            Save this as <strong>WHATSAPP_PERSONAL_PHONE_ID</strong> on Admin → Integrations. Until you do,
            nothing changes: messages on that number are neither stored nor answered.
          </p>
        </div>
      )}
    </div>
  );
}
