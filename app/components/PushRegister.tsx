"use client";

import { useEffect } from "react";

// ASK FOR NOTIFICATIONS, then tell the server where to send them.
//
// Nothing is rendered. It runs inside the apps only — a browser is left alone,
// because a website that raises a notification box on arrival gets refused
// once and can never ask again.
//
// Timing matters twice over:
//  · The Capacitor bridge is injected by the WebView, which is a race against
//    React mounting. Checked once on mount it is usually absent, and the app
//    silently never registers — so it is polled for a few seconds.
//  · The permission box is raised a few seconds in, not at launch. A box that
//    appears before the student has seen anything reads as an intrusion; one
//    that appears while they are already looking at their classes reads as an
//    offer.
export default function PushRegister() {
  useEffect(() => {
    let stop = false;
    let tries = 0;

    const register = async () => {
      const cap = (window as unknown as {
        Capacitor?: {
          isNativePlatform?: () => boolean;
          getPlatform?: () => string;
          Plugins?: Record<string, any>;
        };
      }).Capacitor;
      if (!cap?.isNativePlatform?.()) return;

      const PushNotifications = cap.Plugins?.PushNotifications;
      if (!PushNotifications) return;

      const platform = cap.getPlatform?.() ?? "";
      if (platform !== "ios" && platform !== "android") return;

      // On Android, registering without Firebase configured does not fail
      // politely — it throws on a native thread and takes the app down five
      // seconds after launch, every launch, with nothing the page can catch.
      // The app itself says whether Firebase is really there; anything other
      // than a clear yes means do not ask.
      if (platform === "android") {
        const ready = (window as unknown as { __pushReady?: boolean }).__pushReady;
        if (ready !== true) return;
      }

      try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await PushNotifications.requestPermissions();
        }
        // Refused is a real answer. Do not ask again; the phone's own settings
        // are where a student turns it back on.
        if (perm.receive !== "granted") return;

        PushNotifications.addListener("registration", async (t: { value: string }) => {
          if (!t?.value) return;
          try {
            await fetch("/api/push/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token: t.value,
                platform,
                appVersion: (window as unknown as { APP_VERSION?: string }).APP_VERSION ?? "",
              }),
            });
          } catch {
            // Offline at launch. The next launch registers again.
          }
        });

        // Tapping the notification should land on the thing it was about,
        // not on whatever screen the app happened to be showing.
        PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (a: { notification?: { data?: { link?: string } } }) => {
            const link = a?.notification?.data?.link;
            if (!link) return;
            // The same Link box on the broadcast desk feeds Telegram and email,
            // where a full https:// address is the only thing that makes sense.
            // Accepting only a bare path meant a perfectly normal link opened
            // nothing at all — the notification arrived and the tap did
            // nothing. Both forms are honoured; anything pointing off our own
            // site is refused, so a notification can never be a way to send a
            // student somewhere else.
            try {
              if (link.startsWith("/")) { window.location.assign(link); return; }
              const u = new URL(link, window.location.origin);
              if (u.origin === window.location.origin) window.location.assign(u.pathname + u.search + u.hash);
            } catch {
              // Not a link we can make sense of; leave the student where they are.
            }
          },
        );

        await PushNotifications.register();
      } catch {
        // Push is a courtesy, never a blocker: if any of it fails the app
        // carries on exactly as before.
      }
    };

    const tick = () => {
      if (stop) return;
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform?.()) {
        // Let them look at the app first.
        setTimeout(() => { if (!stop) void register(); }, 5000);
        return;
      }
      if (++tries < 20) setTimeout(tick, 250); // ~5s of waiting for the bridge
    };
    tick();

    return () => { stop = true; };
  }, []);

  return null;
}
