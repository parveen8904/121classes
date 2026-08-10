import { deviceKind, isNativeApp, sameDevice } from "../lib/device";

// ONE SESSION PER KIND OF DEVICE, WITHOUT A STUDENT FIGHTING THEMSELVES.
//
// The rule stops a subscription being passed round a study group. It used to
// sort everything into "mobile" or "desktop", which made our own app and the
// phone's browser the same thing: install the app, open the site in Chrome on
// that same phone, and signing into one signed you out of the other — with a
// message saying the account had been used on another device. It had not. 57
// app sessions and 400 mobile-browser sessions were on record, and every
// student holding both was evicting themselves back to a login screen.

const ANDROID_APP =
  "Mozilla/5.0 (Linux; Android 14; SM-G991B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IOS_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── The app is not the phone's browser ─────────────────────────────────────
check(isNativeApp(ANDROID_APP), "an Android WebView is our app");
check(!isNativeApp(ANDROID_CHROME), "Chrome on Android is not our app");
check(isNativeApp(IOS_APP), "an iOS WKWebView is our app");
check(!isNativeApp(IOS_SAFARI), "Safari on iPhone is not our app");
check(!isNativeApp(WINDOWS) && !isNativeApp(MAC), "a computer is never our app");

check(deviceKind(ANDROID_APP) === "app", "the Android app gets its own slot");
check(deviceKind(IOS_APP) === "app", "so does the iPhone app");
check(deviceKind(ANDROID_CHROME) === "mobile", "the phone browser stays 'mobile'");
check(deviceKind(IOS_SAFARI) === "mobile", "and so does Safari");
check(deviceKind(IPAD_SAFARI) === "mobile", "an iPad is a phone-shaped device here, as before");
check(deviceKind(WINDOWS) === "desktop" && deviceKind(MAC) === "desktop", "computers stay 'desktop'");

// THE POINT OF ALL OF IT: app and browser on one phone must not evict each other.
check(deviceKind(ANDROID_APP) !== deviceKind(ANDROID_CHROME),
  "the Android app and Chrome on the same phone must be different kinds");
check(deviceKind(IOS_APP) !== deviceKind(IOS_SAFARI),
  "the iPhone app and Safari on the same phone must be different kinds");

// ── But a genuinely second device is still one session ─────────────────────
check(deviceKind(ANDROID_CHROME) === deviceKind(IOS_SAFARI),
  "two different phones' browsers share one slot — that is the rule working");

// ── The same phone signing in again is not a second person ────────────────
check(sameDevice(ANDROID_CHROME, ANDROID_CHROME), "cookies cleared on the same phone is the same phone");
check(!sameDevice(ANDROID_CHROME, IOS_SAFARI), "a different phone is a different phone");
check(!sameDevice(null, ANDROID_CHROME), "no record of a user agent must never count as a match");
check(!sameDevice("", ANDROID_CHROME), "nor an empty one — that would exempt everybody");
check(!sameDevice("   ", ANDROID_CHROME), "nor whitespace");

// An unknown user agent must fall back to the old behaviour, never to "app".
check(deviceKind("") === "desktop", "an empty user agent is treated as a computer, as before");

console.log(fails === 0 ? "PASS  device sessions: the app is its own kind, and one phone cannot evict itself" : "");
process.exit(fails === 0 ? 0 : 1);
