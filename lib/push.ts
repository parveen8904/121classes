import crypto from "crypto";
import http2 from "http2";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

// PUSH NOTIFICATIONS to the iPhone and Android apps.
//
// TWO ROADS, because the phones do not share one.
//
//   Android → Firebase Cloud Messaging. The app is handed an FCM token.
//   iPhone  → Apple's own service, directly. Capacitor hands the app an APNS
//             token, which Firebase cannot deliver to. Routing both through
//             Firebase — the obvious economy — would have meant every iPhone
//             silently receiving nothing, with a send that reported success.
//
// So the platform column on push_devices is not decoration: it decides which
// service the message is handed to. Each needs its own credential, and either
// works on its own — Android notifications do not wait on the Apple key.
//
// Credentials, both pasted in Integrations:
//   FCM_SERVICE_ACCOUNT  the whole JSON from Firebase → Service accounts
//   APNS_KEY_P8          the .p8 key from Apple Developer → Keys (downloads ONCE)
//   APNS_KEY_ID          the 10-character key ID shown beside it
//   APNS_TEAM_ID         the 10-character team ID (top-right of the Apple site)

const BUNDLE_ID = "in.caclasses.app";

export type PushMessage = {
  title: string;
  body: string;
  /** Where tapping it should land, as a site path: "/learn/downloads". */
  link?: string;
};

export type SendResult = {
  sent: number;
  failed: number;
  retired: number;
  /** Per platform, so "it did not arrive on iPhones" is answerable from a record. */
  byPlatform?: { android: { sent: number; failed: number }; ios: { sent: number; failed: number } };
};
const NOTHING: SendResult = { sent: 0, failed: 0, retired: 0 };
const add = (a: SendResult, b: SendResult): SendResult => ({
  sent: a.sent + b.sent,
  failed: a.failed + b.failed,
  retired: a.retired + b.retired,
});

// ---- readiness --------------------------------------------------------------

export async function androidPushConfigured(): Promise<boolean> {
  return Boolean(await firebaseAccount());
}
export async function iosPushConfigured(): Promise<boolean> {
  return Boolean(await appleKey());
}
/** True when at least one kind of phone can be reached. */
export async function pushConfigured(): Promise<boolean> {
  return (await androidPushConfigured()) || (await iosPushConfigured());
}

// ---- Android: Firebase Cloud Messaging ---------------------------------------

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

async function firebaseAccount(): Promise<ServiceAccount | null> {
  const raw = await getSecret("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j.project_id || !j.client_email || !j.private_key) return null;
    // Pasted through a form, the newlines in the key usually arrive escaped.
    // Left as a literal "\n" the signature fails with an error that explains
    // nothing.
    return { ...j, private_key: String(j.private_key).replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

// Google's token endpoint wants a JWT signed by the service account and hands
// back an access token good for an hour. Fetching a fresh one per message would
// double the cost of every send, so it is held until just before it expires.
let googleToken: { token: string; until: number } | null = null;

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  if (googleToken && googleToken.until > Date.now() + 60_000) return googleToken.token;

  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    `${enc({ alg: "RS256", typ: "JWT" })}.` +
    enc({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Firebase refused the service account: ${j.error_description || j.error || res.status}`);
  }
  googleToken = { token: j.access_token, until: Date.now() + (Number(j.expires_in || 3600) - 120) * 1000 };
  return googleToken.token;
}

async function sendAndroid(tokens: string[], msg: PushMessage): Promise<{ result: SendResult; dead: string[] }> {
  const sa = await firebaseAccount();
  if (!sa || !tokens.length) return { result: NOTHING, dead: [] };

  const auth = await googleAccessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const dead: string[] = [];
  let sent = 0;
  let failed = 0;

  await lanes(tokens, 20, async (token) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            // The path travels as data so the app can open the right screen;
            // the notification itself carries only what is shown.
            data: msg.link ? { link: msg.link } : undefined,
            android: { priority: "high", notification: { sound: "default" } },
          },
        }),
      });
      if (res.ok) { sent++; return; }
      failed++;
      const j = await res.json().catch(() => ({}));
      const code = j?.error?.details?.[0]?.errorCode || j?.error?.status;
      // The app was deleted, or the token was replaced. Kept on the list, it is
      // dead weight in every future broadcast.
      if (res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") dead.push(token);
    } catch {
      failed++;
    }
  });

  return { result: { sent, failed, retired: 0 }, dead };
}

// ---- iPhone: Apple Push Notification service ---------------------------------

type AppleKey = { p8: string; keyId: string; teamId: string };

/**
 * Put a pasted key back into the shape crypto expects.
 *
 * A .p8 opened in TextEdit and copied out rarely survives intact: the
 * -----BEGIN----- and -----END----- lines get left behind, or the line breaks
 * are flattened, or the newlines arrive escaped from a form post. The key
 * material is all still there — only its wrapping is gone — and rejecting it
 * would mean iPhone notifications quietly never work, with a form that looked
 * perfectly filled in. So it is repaired instead.
 */
function asPem(raw: string): string {
  const text = raw.replace(/\\n/g, "\n").trim();
  const body = text
    .replace(/-----BEGIN[^-]*-----/g, "")
    .replace(/-----END[^-]*-----/g, "")
    .replace(/\s+/g, "");
  if (!body) return "";
  // Anything that is not base64 is not a key, and guessing further would only
  // turn a clear failure into a confusing one.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return "";
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/**
 * A key id and a team id are both exactly ten characters of A–Z and 0–9.
 *
 * Somebody pasted the whole .p8 private key into the Key ID box, so every JWT
 * we signed carried a 262-character PEM as its "kid". Apple rejected all of
 * them, no iPhone ever received a notification, and nothing anywhere said why —
 * the code took whatever was in the field and signed with it.
 *
 * The shape is unmistakable, so a wrong one is now caught here and NAMED.
 */
const looksLikeAppleId = (v: string) => /^[A-Z0-9]{10}$/.test(v);

async function appleKey(): Promise<AppleKey | null> {
  const p8 = asPem(await getSecret("APNS_KEY_P8"));
  const keyId = (await getSecret("APNS_KEY_ID")).trim();
  const teamId = (await getSecret("APNS_TEAM_ID")).trim();
  if (!p8 || !keyId || !teamId) return null;

  if (!looksLikeAppleId(keyId)) {
    console.error(
      `[push] APNS_KEY_ID is not a key id — it is ${keyId.length} characters` +
        `${keyId.includes("PRIVATE KEY") ? " and appears to be the .p8 private key itself" : ""}. ` +
        `Apple expects ten characters like L7U28SG58S. Fix it in Admin → Integrations; ` +
        `iPhone notifications cannot work until it is right.`,
    );
    return null;
  }
  if (!looksLikeAppleId(teamId)) {
    console.error(
      `[push] APNS_TEAM_ID is not a team id — it is ${teamId.length} characters. ` +
        `Apple expects ten characters like 32W63QKXH8.`,
    );
    return null;
  }
  return { p8, keyId, teamId };
}

// Apple rejects a token minted more often than once every twenty minutes and
// will not accept one older than an hour, so this sits deliberately in between.
let appleToken: { token: string; until: number } | null = null;

function appleAuthToken(k: AppleKey): string {
  if (appleToken && appleToken.until > Date.now()) return appleToken.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "ES256", kid: k.keyId, typ: "JWT" })}.${enc({ iss: k.teamId, iat: now })}`;
  // ES256 signatures must be the raw r||s pair, not the DER wrapping Node
  // produces by default. With DER, Apple answers 403 InvalidProviderToken and
  // says nothing about why.
  const sig = crypto
    .createSign("SHA256")
    .update(unsigned)
    .sign({ key: k.p8, dsaEncoding: "ieee-p1363" }, "base64url");
  const token = `${unsigned}.${sig}`;
  appleToken = { token, until: Date.now() + 40 * 60_000 };
  return token;
}

async function sendApple(tokens: string[], msg: PushMessage): Promise<{ result: SendResult; dead: string[] }> {
  const k = await appleKey();
  if (!k || !tokens.length) return { result: NOTHING, dead: [] };

  const jwt = appleAuthToken(k);
  const payload = JSON.stringify({
    aps: { alert: { title: msg.title, body: msg.body }, sound: "default" },
    ...(msg.link ? { link: msg.link } : {}),
  });

  // Apple runs TWO push services, and a token is only valid on the one that
  // issued it. A phone carrying a build signed for development holds a SANDBOX
  // token; production APNs answers BadDeviceToken for it and the message is
  // dropped in silence. That is what stopped the iPhones while Android worked:
  // both iOS devices failed, six Android succeeded, and the count read 6 of 8.
  //
  // Worse, BadDeviceToken was treated as proof the app had been deleted, so the
  // phone was retired and never written to again — one send was enough to lose
  // it for good.
  //
  // So production is tried first and anything Apple calls a bad token is tried
  // again on sandbox. Only a token both services refuse is really dead.
  const prod = await sendAppleVia("https://api.push.apple.com", tokens, jwt, payload);
  let sent = prod.sent;
  let failed = prod.failed - prod.wrongEnvironment.length;
  const dead: string[] = [...prod.dead];

  if (prod.wrongEnvironment.length) {
    const sand = await sendAppleVia(
      "https://api.sandbox.push.apple.com",
      prod.wrongEnvironment,
      jwt,
      payload,
    );
    sent += sand.sent;
    failed += sand.failed;
    // Refused by both services — now it is genuinely gone.
    dead.push(...sand.dead, ...sand.wrongEnvironment);
  }

  return { result: { sent, failed, retired: 0 }, dead };
}

type AppleRun = { sent: number; failed: number; dead: string[]; wrongEnvironment: string[] };

/** One APNs host, one connection, every token. */
async function sendAppleVia(
  host: string,
  tokens: string[],
  jwt: string,
  payload: string,
): Promise<AppleRun> {
  // Apple speaks HTTP/2 only, which fetch() does not — every message would come
  // back as a connection error. One connection carries the whole broadcast,
  // which is also the efficient way to do it.
  const client = http2.connect(host);
  const dead: string[] = [];
  const wrongEnvironment: string[] = [];
  let sent = 0;
  let failed = 0;

  const one = (token: string) =>
    new Promise<void>((done) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; done(); } };
      try {
        const req = client.request({
          ":method": "POST",
          ":path": `/3/device/${token}`,
          authorization: `bearer ${jwt}`,
          "apns-topic": BUNDLE_ID,
          "apns-push-type": "alert",
          "apns-priority": "10",
        });
        let status = 0;
        let bodyText = "";
        req.on("response", (h) => { status = Number(h[":status"] ?? 0); });
        req.on("data", (c: Buffer) => { bodyText += c.toString(); });
        req.on("end", () => {
          if (status === 200) {
            sent++;
          } else {
            failed++;
            let reason = "";
            try { reason = JSON.parse(bodyText)?.reason ?? ""; } catch { /* not JSON */ }
            // 410 Unregistered is Apple saying the app is gone — that is final.
            // BadDeviceToken usually means the token belongs to the OTHER
            // service, so it is worth one more try before writing the phone off.
            if (status === 410 || reason === "Unregistered") dead.push(token);
            else if (reason === "BadDeviceToken") wrongEnvironment.push(token);
            else console.error(`[push] apple refused (${status} ${reason || "no reason"})`);
          }
          finish();
        });
        req.on("error", () => { failed++; finish(); });
        req.setTimeout(20_000, () => { failed++; req.close(); finish(); });
        req.end(payload);
      } catch {
        failed++;
        finish();
      }
    });

  try {
    await lanes(tokens, 20, one);
  } finally {
    client.close();
  }

  return { sent, failed, dead, wrongEnvironment };
}

// ---- the shared part ---------------------------------------------------------

/** Run `job` over `items`, at most `width` at a time. */
async function lanes<T>(items: T[], width: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await job(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
}

export type Device = { token: string; platform: string };

/**
 * Send to an explicit list of phones, each routed to its own service.
 *
 * Exported because the digest already knows exactly which devices it means,
 * and re-deriving them from student ids would be a second trip for an answer
 * it is holding.
 */
export async function pushToDevices(devices: Device[], msg: PushMessage): Promise<SendResult> {
  return send(devices, msg);
}

async function send(devices: Device[], msg: PushMessage): Promise<SendResult> {
  if (!devices.length) return NOTHING;

  const android = devices.filter((d) => d.platform === "android").map((d) => d.token);
  const ios = devices.filter((d) => d.platform === "ios").map((d) => d.token);

  // Both at once. One service being slow should not hold the other up, and one
  // credential being absent must not stop the phones we CAN reach.
  const [a, i] = await Promise.all([sendAndroid(android, msg), sendApple(ios, msg)]);

  const dead = [...a.dead, ...i.dead];
  if (dead.length) {
    const svc = createServiceClient();
    // In pages: a very long IN list is rejected outright, and every dead token
    // would survive to be tried again on the next broadcast.
    for (let n = 0; n < dead.length; n += 200) {
      await svc
        .from("push_devices")
        .update({ disabled_at: new Date().toISOString() })
        .in("token", dead.slice(n, n + 200));
    }
  }

  return {
    ...add(a.result, i.result),
    retired: dead.length,
    // Split by platform. The counts used to arrive as one number, so a
    // broadcast that reached every Android and no iPhone read as "6 of 8" —
    // true, and useless for working out which half had failed.
    byPlatform: {
      android: { sent: a.result.sent, failed: a.result.failed },
      ios: { sent: i.result.sent, failed: i.result.failed },
    },
  };
}

/** Send to one student's phones. */
export async function pushToUser(userId: string, msg: PushMessage): Promise<SendResult> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("push_devices")
    .select("token, platform")
    .eq("user_id", userId)
    .is("disabled_at", null);
  return send((data ?? []) as Device[], msg);
}

/**
 * Send to every registered phone — the broadcast desk.
 */
export async function pushToEveryone(msg: PushMessage): Promise<SendResult> {
  const svc = createServiceClient();
  const devices: Device[] = [];
  // PostgREST caps a select at a thousand rows and says nothing about the rest,
  // so the list is read a page at a time. Read in one go, a broadcast to ten
  // thousand students would have reached the first thousand and reported
  // success — the same trap that hid two thirds of the AI bill.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await svc
      .from("push_devices")
      .select("token, platform")
      .is("disabled_at", null)
      .order("last_seen_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) break;
    const page = (data ?? []) as Device[];
    devices.push(...page);
    if (page.length < PAGE) break;
  }
  return send(devices, msg);
}
