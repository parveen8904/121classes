// ONE ACTIVE SESSION PER KIND OF DEVICE — AND THE APP IS ITS OWN KIND.
//
// The rule exists so one subscription is not shared around a study group. It
// worked by sorting every request into "mobile" or "desktop" and allowing one
// live session in each.
//
// Which meant our own app and the phone's browser were the same thing. A
// student who installed the app AND opened the site in Chrome on that same
// phone was two sessions of one kind, so signing into one signed them out of
// the other — with a message telling them their account had been used on
// another device, which was untrue and alarming. 57 app sessions and 400
// mobile-browser sessions are on record; every student holding both was
// fighting themselves, and each eviction sent them back to a login screen with
// a password some of them did not have.
//
// So the app counts separately. Sharing a subscription across a real second
// phone is still caught: that is another browser session of the same kind.

export type DeviceKind = "app" | "mobile" | "desktop";

/**
 * Is this our own app rather than a browser?
 *
 * Read from the user agent, because the apps already in students' hands cannot
 * be changed to announce themselves. Both tests are about the WEBVIEW a native
 * app embeds:
 *
 *   Android — Chrome inside an app puts "; wv)" in the user agent. A browser
 *             never does.
 *   iOS     — Safari says "Safari/604.1"; a WKWebView inside an app says
 *             "Mobile/15E148" and no Safari token at all.
 *
 * Wrong either way is survivable: a misread app is treated as a phone browser,
 * which is exactly what happens today.
 */
export function isNativeApp(ua: string): boolean {
  const s = ua || "";
  if (/;\s*wv\)/i.test(s)) return true;                       // Android WebView
  if (/\bCapacitor\b/i.test(s)) return true;                  // if a build ever says so
  if (/iPhone|iPad|iPod/i.test(s) && /Mobile\/\w+/i.test(s) && !/Safari\//i.test(s)) return true;
  return false;
}

export function deviceKind(ua: string): DeviceKind {
  if (isNativeApp(ua)) return "app";
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua) ? "mobile" : "desktop";
}

/**
 * Is this the same physical device signing in again?
 *
 * Clearing cookies, reinstalling the app, or opening a private window all
 * produce a fresh session on the SAME phone. Evicting for that is a student
 * being told they are logged in somewhere else when they are holding the only
 * device they own. When the user agent is identical, treat it as the same
 * device and simply refresh — the rule is about a second person, not a second
 * cookie jar.
 */
export function sameDevice(storedUa: string | null | undefined, incomingUa: string): boolean {
  const a = (storedUa ?? "").trim();
  const b = (incomingUa ?? "").trim();
  return a.length > 0 && a === b;
}
